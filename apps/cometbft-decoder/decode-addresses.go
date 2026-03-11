package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	bip39 "github.com/tyler-smith/go-bip39"
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
	keyBytes, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil {
		return "", fmt.Errorf("error decoding base64: %v", err)
	}

	pubKey := new(blst.P1Affine).Deserialize(keyBytes)
	if pubKey == nil {
		return "", fmt.Errorf("invalid public key")
	}

	if !pubKey.KeyValidate() {
		return "", fmt.Errorf("invalid public key")
	}

	compressed := pubKey.Compress()
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

	client := &http.Client{Timeout: 30 * time.Second}
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
	client := &http.Client{Timeout: 10 * time.Second}
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

func removeEmojis(text string) string {
	if text == "" {
		return text
	}
	emojiRegex := regexp.MustCompile(`[\x{1F600}-\x{1F64F}]|[\x{1F300}-\x{1F5FF}]|[\x{1F680}-\x{1F6FF}]|[\x{1F1E0}-\x{1F1FF}]|[\x{2600}-\x{26FF}]|[\x{2700}-\x{27BF}]|[\x{1F900}-\x{1F9FF}]|[\x{1FA70}-\x{1FAFF}]`)
	cleaned := emojiRegex.ReplaceAllString(text, "")
	return strings.TrimSpace(cleaned)
}

// threeWordName generates a deterministic 3-word name from a compressed pubkey hex string.
// Uses SHA256 of the pubkey and maps 3 pairs of bytes into BIP39 word indices.
func threeWordName(pubkeyHex string) string {
	wordList := bip39.GetWordList()
	listLen := uint16(len(wordList)) // 2048

	hash := sha256.Sum256([]byte(pubkeyHex))

	idx0 := binary.BigEndian.Uint16(hash[0:2]) % listLen
	idx1 := binary.BigEndian.Uint16(hash[2:4]) % listLen
	idx2 := binary.BigEndian.Uint16(hash[4:6]) % listLen

	return fmt.Sprintf("%s-%s-%s", wordList[idx0], wordList[idx1], wordList[idx2])
}

// loadDelegatedPubkeys reads delegated_validators.csv and returns a set of pubkeys (column 3, 0-indexed).
func loadDelegatedPubkeys(csvPath string) (map[string]bool, error) {
	delegated := make(map[string]bool)

	f, err := os.Open(csvPath)
	if err != nil {
		return delegated, fmt.Errorf("cannot open %s: %v", csvPath, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	firstLine := true
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if firstLine {
			firstLine = false
			continue // skip header
		}
		parts := strings.Split(line, ",")
		if len(parts) < 3 {
			continue
		}
		pubkey := strings.TrimSpace(parts[2])
		if pubkey != "" {
			delegated[strings.ToLower(pubkey)] = true
		}
	}
	return delegated, scanner.Err()
}

// addColumnIfMissing runs ALTER TABLE ADD COLUMN and ignores the error if the column already exists.
func addColumnIfMissing(db *sql.DB, table, colDef string) {
	_, err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s", table, colDef))
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		fmt.Printf("Warning: could not add column %q to %s: %v\n", colDef, table, err)
	}
}

func main() {
	apiURL := os.Getenv("CL_ETHRPC_URL")
	if apiURL == "" {
		apiURL = "http://localhost:59820"
	}

	dbPath := os.Getenv("VALIDATOR_DB_PATH")
	if dbPath == "" {
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Printf("Error getting current directory: %v\n", err)
			return
		}
		dbPath = filepath.Join(cwd, "..", "var", "db", "validator.sqlite")
		dbPath, err = filepath.Abs(dbPath)
		if err != nil {
			fmt.Printf("Error resolving database path: %v\n", err)
			return
		}
	}

	// Delegated validators CSV — default path relative to this binary's directory,
	// pointing into the pol-performance-study directory.
	delegatedCSV := os.Getenv("DELEGATED_CSV_PATH")
	if delegatedCSV == "" {
		cwd, _ := os.Getwd()
		delegatedCSV = filepath.Join(cwd, "..", "pol-performance-study", "delegated_validators.csv")
		delegatedCSV, _ = filepath.Abs(delegatedCSV)
	}

	// Load delegated pubkeys
	delegatedPubkeys, err := loadDelegatedPubkeys(delegatedCSV)
	if err != nil {
		fmt.Printf("Warning: could not load delegated validators CSV (%s): %v — is_delegated will not be set\n", delegatedCSV, err)
	} else {
		fmt.Printf("Loaded %d delegated validator pubkeys from %s\n", len(delegatedPubkeys), delegatedCSV)
	}

	// Ensure DB directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		fmt.Printf("Error creating database directory: %v\n", err)
		return
	}

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

	// Add new columns — safe if they already exist
	addColumnIfMissing(db, "validators", "is_delegated INTEGER DEFAULT 0")
	addColumnIfMissing(db, "validators", "exception_note TEXT")

	// Fetch validators from GraphQL API
	fmt.Println("Fetching validators from GraphQL API...")
	graphqlResponse, err := fetchGraphQLValidators()
	if err != nil {
		fmt.Printf("Error fetching GraphQL validators: %v\n", err)
		return
	}

	graphqlValidatorMap := make(map[string]struct {
		Name     string
		Address  string
		Operator string
	})
	for _, v := range graphqlResponse.Data.Validators.Validators {
		graphqlValidatorMap[v.Pubkey] = struct {
			Name     string
			Address  string
			Operator string
		}{
			Name:     v.Metadata.Name,
			Address:  v.ID,
			Operator: v.Operator,
		}
	}
	fmt.Printf("Found %d validators from GraphQL API\n", len(graphqlValidatorMap))

	// Fetch active validators from CometBFT API
	validatorsURL := fmt.Sprintf("%s/validators?per_page=200", apiURL)
	fmt.Println("Fetching validators from CometBFT API...")
	response, err := fetchValidators(validatorsURL)
	if err != nil {
		fmt.Printf("Error fetching validators: %v\n", err)
		return
	}
	fmt.Printf("Found %d validators from CometBFT API\n", len(response.Result.Validators))

	fmt.Println("proposer_address,name,address,pubkey,voting_power,operator,status,is_delegated,exception_note")

	matchedCount := 0
	activeValidators := make(map[string]bool)
	exceptionCount := 0

	for _, validator := range response.Result.Validators {
		// Per-validator error recovery — flag exceptions, never crash
		func(v Validator) {
			var exceptionNote string

			compressedKey, convErr := convertPubKey(v.PubKey.Value)
			if convErr != nil {
				exceptionNote = fmt.Sprintf("pubkey decompression failed: %v", convErr)
				fmt.Printf("Exception: %s for CometBFT address %s\n", exceptionNote, v.Address)
				_, dbErr := db.Exec(`
					INSERT OR REPLACE INTO validators (proposer_address, name, pubkey, voting_power, status, exception_note)
					VALUES (?, ?, ?, ?, ?, ?)
				`, v.Address, "", v.PubKey.Value, v.VotingPower, "active_ongoing", exceptionNote)
				if dbErr != nil {
					fmt.Printf("Error writing exception row for %s: %v\n", v.Address, dbErr)
				}
				exceptionCount++
				return
			}

			activeValidators[compressedKey] = true

			var name, address, operator string
			if graphqlData, exists := graphqlValidatorMap[compressedKey]; exists {
				name = graphqlData.Name
				address = graphqlData.Address
				operator = graphqlData.Operator
				matchedCount++
			}

			name = removeEmojis(name)
			name = strings.ReplaceAll(name, ",", ";")

			// Auto-name validators with no metadata name
			if name == "" {
				name = threeWordName(compressedKey)
				if exceptionNote == "" {
					exceptionNote = "auto-named: not in metadata"
				}
			}

			isDelegated := 0
			if delegatedPubkeys[strings.ToLower(compressedKey)] {
				isDelegated = 1
			}

			fmt.Printf("%s,%s,%s,%s,%s,%s,active_ongoing,%d,%s\n",
				v.Address, name, address, compressedKey, v.VotingPower, operator, isDelegated, exceptionNote)

			_, dbErr := db.Exec(`
				INSERT OR REPLACE INTO validators (proposer_address, name, address, pubkey, voting_power, operator, status, is_delegated, exception_note)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, v.Address, name, address, compressedKey, v.VotingPower, operator, "active_ongoing", isDelegated, nullIfEmpty(exceptionNote))
			if dbErr != nil {
				fmt.Printf("Error inserting validator %s: %v\n", v.Address, dbErr)
			}
		}(validator)
	}

	// Mark GraphQL validators not in active CometBFT set as exited
	fmt.Println("\n--- Exited Validators ---")
	exitedCount := 0
	for pubkey, graphqlData := range graphqlValidatorMap {
		if activeValidators[pubkey] {
			continue
		}
		name := removeEmojis(graphqlData.Name)
		name = strings.ReplaceAll(name, ",", ";")

		isDelegated := 0
		if delegatedPubkeys[strings.ToLower(pubkey)] {
			isDelegated = 1
		}

		fmt.Printf(",%s,%s,%s,0,%s,exited,%d,\n",
			name, graphqlData.Address, pubkey, graphqlData.Operator, isDelegated)

		_, err := db.Exec(`
			INSERT OR REPLACE INTO validators (proposer_address, name, address, pubkey, voting_power, operator, status, is_delegated)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, "", name, graphqlData.Address, pubkey, "0", graphqlData.Operator, "exited", isDelegated)
		if err != nil {
			fmt.Printf("Error inserting exited validator %s: %v\n", pubkey, err)
		} else {
			exitedCount++
		}
	}

	fmt.Printf("\nSuccessfully matched active: %d out of %d validators\n", matchedCount, len(response.Result.Validators))
	fmt.Printf("Auto-named (no metadata): %d validators\n", len(response.Result.Validators)-matchedCount-exceptionCount)
	fmt.Printf("Exceptions flagged: %d validators\n", exceptionCount)
	fmt.Printf("Marked as exited: %d validators\n", exitedCount)
	fmt.Printf("Match rate: %.1f%%\n", float64(matchedCount)/float64(len(response.Result.Validators))*100)
	fmt.Printf("Data has been saved to %s\n", dbPath)
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
