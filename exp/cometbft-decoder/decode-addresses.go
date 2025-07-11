package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	_ "github.com/mattn/go-sqlite3"
	blst "github.com/supranational/blst/bindings/go"
)

type Validator struct {
	Address string `json:"address"`
	PubKey  struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"pub_key"`
}

type Response struct {
	Result struct {
		Validators []Validator `json:"validators"`
	} `json:"result"`
}

type StatusResponse struct {
	Result struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			LatestBlockHeight string `json:"latest_block_height"`
		} `json:"sync_info"`
	} `json:"result"`
}

func convertPubKey(base64Key string) (string, error) {
	// Decode base64
	keyBytes, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil {
		return "", fmt.Errorf("error decoding base64: %v", err)
	}

	// Create BLS public key from bytes
	pubKey := new(blst.P1Affine).Deserialize(keyBytes)
	if pubKey == nil {
		return "", fmt.Errorf("invalid public key")
	}

	// Validate the key
	if !pubKey.KeyValidate() {
		return "", fmt.Errorf("invalid public key")
	}

	// Get compressed bytes
	compressed := pubKey.Compress()

	// Convert to hex string
	return fmt.Sprintf("0x%x", compressed), nil
}

func fetchValidatorTitle(compressedKey string, hubURL string) (string, error) {
	url := fmt.Sprintf("%s/validators/%s/", hubURL, compressedKey)

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("error fetching validator page: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("error status code: %d", resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error parsing HTML: %v", err)
	}

	title := strings.TrimSpace(doc.Find("title").Text())
	if title == "" {
		return "", fmt.Errorf("title tag not found")
	}

	// Split by | and take the first part
	parts := strings.Split(title, "|")
	if len(parts) > 0 {
		name := strings.TrimSpace(parts[0])
		// If the name is just "Validators" or empty, return empty string
		if name == "Validators" || name == "" {
			return "", nil
		}
		return name, nil
	}

	return "", nil
}

func fetchValidators(url string) (*Response, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("error fetching validators: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error status code: %d", resp.StatusCode)
	}

	// Read and print the raw response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %v", err)
	}

	// Create a new reader with the body for JSON decoding
	var response Response
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding JSON: %v", err)
	}

	return &response, nil
}

func checkNodeStatus(url string) error {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(fmt.Sprintf("%s/status", url))
	if err != nil {
		return fmt.Errorf("error checking node status: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("error status code: %d", resp.StatusCode)
	}

	var status StatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return fmt.Errorf("error decoding status response: %v", err)
	}

	// fmt.Printf("Node network: %s\n", status.Result.NodeInfo.Network)
	// fmt.Printf("Latest block height: %s\n", status.Result.SyncInfo.LatestBlockHeight)
	return nil
}

func main() {
	// Get API URL from environment variable
	apiURL := os.Getenv("CL_ETHRPC_URL")
	if apiURL == "" {
		apiURL = "http://34.159.172.173:26657"
	}

	// Get Hub URL from environment variable
	hubURL := os.Getenv("BERA_HUB_URL")
	if hubURL == "" {
		hubURL = "https://hub.berachain.com"
	}

	// Initialize SQLite database
	db, err := sql.Open("sqlite3", "validators.db")
	if err != nil {
		fmt.Printf("Error opening database: %v\n", err)
		return
	}
	defer db.Close()

	// Create validators table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS validators (
			address TEXT PRIMARY KEY,
			compressed_pubkey TEXT,
			name TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		fmt.Printf("Error creating table: %v\n", err)
		return
	}

	// Check node status first
	if err := checkNodeStatus(apiURL); err != nil {
		fmt.Printf("Error checking node status: %v\n", err)
		return
	}

	// Construct the validators endpoint URL with parameters
	validatorsURL := fmt.Sprintf("%s/validators?per_page=100", apiURL)

	// Fetch validators from API
	response, err := fetchValidators(validatorsURL)
	if err != nil {
		fmt.Printf("Error fetching validators: %v\n", err)
		return
	}

	// Print CSV header
	fmt.Println("title,address,compressed_pubkey")

	// Process each validator
	for _, validator := range response.Result.Validators {
		compressedKey, err := convertPubKey(validator.PubKey.Value)
		if err != nil {
			fmt.Printf("Error converting key for %s: %v\n", validator.Address, err)
			continue
		}

		// Fetch validator title
		title, err := fetchValidatorTitle(compressedKey, hubURL)
		if err != nil {
			fmt.Printf("Error fetching title for %s: %v\n", validator.Address, err)
			title = "N/A"
		}

		// Escape any commas in the title
		title = strings.ReplaceAll(title, ",", ";")

		// Print to console
		fmt.Printf("%s,%s,%s\n", title, validator.Address, compressedKey)

		// Insert into database
		_, err = db.Exec(`
			INSERT OR REPLACE INTO validators (address, compressed_pubkey, name)
			VALUES (?, ?, ?)
		`, validator.Address, compressedKey, title)
		if err != nil {
			fmt.Printf("Error inserting validator %s: %v\n", validator.Address, err)
		}
	}

	fmt.Println("\nData has been saved to validators.db")
}
