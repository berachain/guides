package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	blst "github.com/supranational/blst/bindings/go"
)

type Validator struct {
	Address string `json:"address"`
	PubKey  struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"pub_key"`
	VotingPower      string `json:"voting_power"`
	ProposerPriority string `json:"proposer_priority"`
}

type Response struct {
	Result struct {
		Validators []Validator `json:"validators"`
	} `json:"result"`
}

type GraphQLQuery struct {
	OperationName string                 `json:"operationName"`
	Variables     map[string]interface{} `json:"variables"`
	Query         string                 `json:"query"`
}

type GraphQLResponse struct {
	Data struct {
		Validators struct {
			Validators []struct {
				ID       string `json:"id"`
				Pubkey   string `json:"pubkey"`
				Operator string `json:"operator"`
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
			} `json:"validators"`
		} `json:"validators"`
	} `json:"data"`
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

func fetchGraphQLValidators() (*GraphQLResponse, error) {
	query := GraphQLQuery{
		OperationName: "GetValidators",
		Variables: map[string]interface{}{
			"sortBy":    "lastDayDistributedBGTAmount",
			"sortOrder": "desc",
			"chain":     "BERACHAIN",
			"where":     map[string]interface{}{},
			"skip":      0,
			"pageSize":  1000,
		},
		Query: `query GetValidators($where: GqlValidatorFilter, $sortBy: GqlValidatorOrderBy = lastDayDistributedBGTAmount, $sortOrder: GqlValidatorOrderDirection = desc, $pageSize: Int, $skip: Int, $search: String, $chain: GqlChain) {
  validators: polGetValidators(
    where: $where
    orderBy: $sortBy
    orderDirection: $sortOrder
    first: $pageSize
    skip: $skip
    search: $search
    chain: $chain
  ) {
    validators {
      id
      pubkey
      operator
      metadata {
        name
      }
    }
  }
}`,
	}

	jsonData, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("error marshaling query: %v", err)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequest("POST", "https://api.berachain.com/graphql", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("error creating request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CometBFT-Decoder/1.0)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error making request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error status code: %d", resp.StatusCode)
	}

	var response GraphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding JSON: %v", err)
	}

	return &response, nil
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

	var response Response
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding JSON: %v", err)
	}

	return &response, nil
}

// removeEmojis removes emoji characters from a string
func removeEmojis(text string) string {
	if text == "" {
		return text
	}
	
	// Regex pattern to match emoji Unicode ranges
	emojiRegex := regexp.MustCompile(`[\x{1F600}-\x{1F64F}]|[\x{1F300}-\x{1F5FF}]|[\x{1F680}-\x{1F6FF}]|[\x{1F1E0}-\x{1F1FF}]|[\x{2600}-\x{26FF}]|[\x{2700}-\x{27BF}]|[\x{1F900}-\x{1F9FF}]|[\x{1FA70}-\x{1FAFF}]`)
	
	// Remove emojis and trim whitespace
	cleaned := emojiRegex.ReplaceAllString(text, "")
	return strings.TrimSpace(cleaned)
}

func main() {
	// Get API URL from environment variable
	apiURL := os.Getenv("CL_ETHRPC_URL")
	if apiURL == "" {
		apiURL = "http://37.27.231.195:59820"
	}

	// Get database path from environment variable or use default
	dbPath := os.Getenv("VALIDATOR_DB_PATH")
	if dbPath == "" {
		// Default to ../var/db/validator.sqlite relative to current working directory
		// This assumes the script is run from apps/cometbft-decoder/ directory
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Printf("Error getting current directory: %v\n", err)
			return
		}
		// If we're in cometbft-decoder, go up one level to apps, then into var/db
		dbPath = filepath.Join(cwd, "..", "var", "db", "validator.sqlite")
		dbPath, err = filepath.Abs(dbPath)
		if err != nil {
			fmt.Printf("Error resolving database path: %v\n", err)
			return
		}
	}

	// Ensure the database directory exists
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		fmt.Printf("Error creating database directory: %v\n", err)
		return
	}

	// Initialize SQLite database
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		fmt.Printf("Error opening database: %v\n", err)
		return
	}
	defer db.Close()

	// Create validators table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS validators (
			proposer_address TEXT,
			name TEXT,
			address TEXT,
			pubkey TEXT PRIMARY KEY,
			voting_power TEXT,
			operator TEXT,
			status TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		fmt.Printf("Error creating table: %v\n", err)
		return
	}

	// Fetch validators from GraphQL API first
	fmt.Println("Fetching validators from GraphQL API...")
	graphqlResponse, err := fetchGraphQLValidators()
	if err != nil {
		fmt.Printf("Error fetching GraphQL validators: %v\n", err)
		return
	}

	// Create a map of GraphQL validators by pubkey for quick lookup
	graphqlValidatorMap := make(map[string]struct {
		Name     string
		Address  string
		Operator string
	})

	for _, validator := range graphqlResponse.Data.Validators.Validators {
		graphqlValidatorMap[validator.Pubkey] = struct {
			Name     string
			Address  string
			Operator string
		}{
			Name:     validator.Metadata.Name,
			Address:  validator.ID,
			Operator: validator.Operator,
		}
	}

	fmt.Printf("Found %d validators from GraphQL API\n", len(graphqlValidatorMap))

	// Construct the validators endpoint URL with parameters
	validatorsURL := fmt.Sprintf("%s/validators?per_page=99", apiURL)

	// Fetch validators from CometBFT API
	fmt.Println("Fetching validators from CometBFT API...")
	response, err := fetchValidators(validatorsURL)
	if err != nil {
		fmt.Printf("Error fetching validators: %v\n", err)
		return
	}

	fmt.Printf("Found %d validators from CometBFT API\n", len(response.Result.Validators))

	// Print CSV header
	fmt.Println("proposer_address,name,address,pubkey,voting_power,operator,status")

	matchedCount := 0

	// Process each validator
	for _, validator := range response.Result.Validators {
		compressedKey, err := convertPubKey(validator.PubKey.Value)
		if err != nil {
			fmt.Printf("Error converting key for %s: %v\n", validator.Address, err)
			continue
		}

		// Look up validator in GraphQL data
		var name, address, operator string
		if graphqlData, exists := graphqlValidatorMap[compressedKey]; exists {
			name = graphqlData.Name
			address = graphqlData.Address
			operator = graphqlData.Operator
			matchedCount++
		} else {
			name = "N/A"
			address = "N/A"
			operator = "N/A"
		}

		// Remove emojis from the name
		name = removeEmojis(name)

		// Escape any commas in the name
		name = strings.ReplaceAll(name, ",", ";")

		// Print to console
		fmt.Printf("%s,%s,%s,%s,%s,%s,active_ongoing\n",
			validator.Address, name, address, compressedKey, validator.VotingPower, operator)

		// Insert into database
		_, err = db.Exec(`
			INSERT OR REPLACE INTO validators (proposer_address, name, address, pubkey, voting_power, operator, status)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, validator.Address, name, address, compressedKey, validator.VotingPower, operator, "active_ongoing")
		if err != nil {
			fmt.Printf("Error inserting validator %s: %v\n", validator.Address, err)
		}
	}

	fmt.Printf("\nSuccessfully matched: %d out of %d validators\n", matchedCount, len(response.Result.Validators))
	fmt.Printf("Match rate: %.1f%%\n", float64(matchedCount)/float64(len(response.Result.Validators))*100)
	fmt.Printf("Data has been saved to %s\n", dbPath)
}
