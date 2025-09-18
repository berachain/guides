package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/p2p"
	"github.com/ethereum/go-ethereum/p2p/enode"
	"github.com/ethereum/go-ethereum/p2p/rlpx"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/olekukonko/tablewriter"
)

// Hello represents a devp2p handshake message
type Hello struct {
	Version    uint64
	Name       string
	Caps       []p2p.Cap
	ListenPort uint64
	ID         []byte
	Rest       []rlp.RawValue `rlp:"tail"`
}

// TestResult holds the results of testing a single enode
type TestResult struct {
	Enode        string
	IsReachable  bool
	HasValidID   bool
	HandshakeOK  bool
	OwnsNodeID   bool // Whether the connected node actually owns the node ID
	Error        string
	ResponseTime time.Duration
	NodeInfo     *Hello
}

// EnodeTester handles testing of multiple enodes
type EnodeTester struct {
	timeout    time.Duration
	concurrent int
	results    []TestResult
	mu         sync.Mutex
}

// NewEnodeTester creates a new enode tester with specified configuration
func NewEnodeTester(timeout time.Duration, concurrent int) *EnodeTester {
	return &EnodeTester{
		timeout:    timeout,
		concurrent: concurrent,
		results:    make([]TestResult, 0),
	}
}

// TestEnode performs comprehensive testing of a single enode
func (et *EnodeTester) TestEnode(enodeStr string) TestResult {
	result := TestResult{
		Enode: enodeStr,
	}

	start := time.Now()
	defer func() {
		result.ResponseTime = time.Since(start)
		et.mu.Lock()
		et.results = append(et.results, result)
		et.mu.Unlock()
	}()

	// Remove comments (everything after #) and whitespace
	cleanEnode := strings.TrimSpace(enodeStr)
	if commentIndex := strings.Index(cleanEnode, "#"); commentIndex != -1 {
		cleanEnode = cleanEnode[:commentIndex]
		cleanEnode = strings.TrimSpace(cleanEnode)
	}

	// Skip empty lines
	if cleanEnode == "" {
		result.Error = "Empty line"
		return result
	}

	// Parse the enode to validate format and extract node ID
	node, err := enode.ParseV4(cleanEnode)
	if err != nil {
		result.Error = fmt.Sprintf("Invalid enode format: %v", err)
		return result
	}

	// Validate that the node ID matches the public key
	pubkey := node.Pubkey()
	if pubkey == nil {
		result.Error = "No public key found in enode"
		return result
	}

	// Verify the node ID is derived from the public key (before attempting connection)
	expectedID := enode.PubkeyToIDV4(pubkey)
	if node.ID() != expectedID {
		result.Error = fmt.Sprintf("Node ID mismatch: expected %s, got %s", expectedID, node.ID())
		return result
	}
	result.HasValidID = true

	// Test basic TCP connectivity (only if valid ID)
	tcpEndpoint := node.TCP()
	if tcpEndpoint == 0 {
		result.Error = "Node has no TCP endpoint"
		return result
	}

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", node.IP(), tcpEndpoint), et.timeout)
	if err != nil {
		result.Error = fmt.Sprintf("TCP connection failed: %v", err)
		return result
	}
	defer conn.Close()
	result.IsReachable = true

	// Test RLPx handshake
	rlpxConn := rlpx.NewConn(conn, pubkey)
	ourKey, err := crypto.GenerateKey()
	if err != nil {
		result.Error = fmt.Sprintf("Failed to generate key: %v", err)
		return result
	}

	// Perform handshake with timeout
	handshakeDone := make(chan error, 1)
	go func() {
		_, err := rlpxConn.Handshake(ourKey)
		handshakeDone <- err
	}()

	select {
	case err := <-handshakeDone:
		if err != nil {
			result.Error = fmt.Sprintf("RLPx handshake failed: %v", err)
			return result
		}
	case <-time.After(et.timeout):
		result.Error = "RLPx handshake timeout"
		return result
	}

	// If handshake succeeded, the node has proven it owns the private key
	// This is because RLPx handshake requires the remote node to sign a challenge
	// with its private key, which we verify using the public key from the enode URL
	result.OwnsNodeID = true

	// Try to read a message to verify the connection is working
	code, data, _, err := rlpxConn.Read()
	if err != nil {
		result.Error = fmt.Sprintf("Failed to read from connection: %v", err)
		return result
	}

	// Handle different message types
	switch code {
	case 0: // Hello message
		var hello Hello
		if err := rlp.DecodeBytes(data, &hello); err != nil {
			result.Error = fmt.Sprintf("Invalid hello message: %v", err)
			return result
		}
		result.NodeInfo = &hello
		result.HandshakeOK = true
	case 1: // Disconnect message
		var reasons []p2p.DiscReason
		if err := rlp.DecodeBytes(data, &reasons); err != nil || len(reasons) == 0 {
			result.Error = "Invalid disconnect message"
			return result
		}
		result.Error = fmt.Sprintf("Node disconnected: %v", reasons[0])
	default:
		result.Error = fmt.Sprintf("Unexpected message code %d", code)
	}

	return result
}

// TestEnodesFromFile reads enodes from a file and tests them
func (et *EnodeTester) TestEnodesFromFile(filename string) error {
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %v", filename, err)
	}
	defer file.Close()

	var enodes []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Remove comments (everything after #)
		if commentIndex := strings.Index(line, "#"); commentIndex != -1 {
			line = line[:commentIndex]
			line = strings.TrimSpace(line)
		}

		// Skip empty lines and non-enode lines
		if line != "" && strings.HasPrefix(line, "enode://") {
			enodes = append(enodes, line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading file: %v", err)
	}

	fmt.Printf("Found %d enodes to test\n", len(enodes))
	return et.TestEnodes(enodes)
}

// TestEnodes tests a list of enodes concurrently
func (et *EnodeTester) TestEnodes(enodes []string) error {
	semaphore := make(chan struct{}, et.concurrent)
	var wg sync.WaitGroup

	for _, enodeStr := range enodes {
		wg.Add(1)
		go func(enode string) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			result := et.TestEnode(enode)
			et.printResult(result)
		}(enodeStr)
	}

	wg.Wait()
	return nil
}

// printResult prints the result of testing a single enode (now just stores for table)
func (et *EnodeTester) printResult(result TestResult) {
	// Results are now printed as a table in PrintSummary
}

// PrintSummary prints a summary of all test results in a nice table, then outputs passed enodes
func (et *EnodeTester) PrintSummary() {
	et.mu.Lock()
	defer et.mu.Unlock()

	// Create table
	table := tablewriter.NewWriter(os.Stdout)
	table.Header("Status", "IP:Port", "Valid ID", "Reachable", "Owns ID", "Handshake", "Time", "Error")

	// Add rows
	for _, result := range et.results {
		// Determine status
		status := "❌ FAIL"
		if result.IsReachable && result.HasValidID && result.HandshakeOK && result.OwnsNodeID {
			status = "✅ PASS"
		} else if result.IsReachable && result.HasValidID && result.OwnsNodeID {
			status = "⚠️ PART  "
		}

		// Extract IP:Port from enode
		ipPort := "Unknown"
		if strings.Contains(result.Enode, "@") {
			parts := strings.Split(result.Enode, "@")
			if len(parts) > 1 {
				ipPort = parts[1]
			}
		}

		// Format boolean values
		validID := "❌"
		if result.HasValidID {
			validID = "✅"
		}

		reachable := "❌"
		if result.IsReachable {
			reachable = "✅"
		}

		ownsID := "❌"
		if result.OwnsNodeID {
			ownsID = "✅"
		}

		handshake := "❌"
		if result.HandshakeOK {
			handshake = "✅"
		}

		// Truncate error message
		errorMsg := result.Error
		if len(errorMsg) > 30 {
			errorMsg = errorMsg[:30] + "..."
		}

		table.Append(status, ipPort, validID, reachable, ownsID, handshake, fmt.Sprintf("%.2fs", result.ResponseTime.Seconds()), errorMsg)
	}

	// Print table
	table.Render()

	// Print summary statistics
	total := len(et.results)
	reachable := 0
	validID := 0
	ownsNodeID := 0
	handshakeOK := 0

	for _, result := range et.results {
		if result.IsReachable {
			reachable++
		}
		if result.HasValidID {
			validID++
		}
		if result.OwnsNodeID {
			ownsNodeID++
		}
		if result.HandshakeOK {
			handshakeOK++
		}
	}

	fmt.Printf("\n📊 SUMMARY: %d total | %d reachable (%.1f%%) | %d valid ID (%.1f%%) | %d owns ID (%.1f%%) | %d handshake OK (%.1f%%)\n",
		total,
		reachable, float64(reachable)/float64(total)*100,
		validID, float64(validID)/float64(total)*100,
		ownsNodeID, float64(ownsNodeID)/float64(total)*100,
		handshakeOK, float64(handshakeOK)/float64(total)*100)

	// Print passed and partial enodes
	fmt.Println("\n✅ PASSED & PARTIAL ENODES:")
	for _, result := range et.results {
		if result.IsReachable && result.HasValidID && result.OwnsNodeID {
			fmt.Println(result.Enode)
		}
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Printf("Usage: %s <enode-file>\n", os.Args[0])
		fmt.Printf("       %s <enode-url>\n", os.Args[0])
		os.Exit(1)
	}

	// Create tester with 10 second timeout and 5 concurrent connections
	tester := NewEnodeTester(10*time.Second, 5)

	arg := os.Args[1]

	// Check if it's a file or a single enode
	if strings.HasPrefix(arg, "enode://") {
		// Single enode
		fmt.Printf("Testing single enode...\n")
		tester.TestEnode(arg)
	} else {
		// File with enodes
		fmt.Printf("Testing enodes from file: %s\n", arg)
		if err := tester.TestEnodesFromFile(arg); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
	}

	tester.PrintSummary()
}
