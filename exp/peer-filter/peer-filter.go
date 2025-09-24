package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// AllowedClients - hardcoded whitelist of allowed client names (from peer-filter inspiration)
var AllowedClients = []string{
	"BeraGeth",
	"BeraReth",
	"bera-reth",
	"reth/v1.6.0-48941e6",
	"reth/v1.7.0-9d56da5",
}

// JSONRPCRequest represents a JSON-RPC 2.0 request
type JSONRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      int         `json:"id"`
}

// JSONRPCResponse represents a JSON-RPC 2.0 response
type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
	ID      int         `json:"id"`
}

// RPCError represents a JSON-RPC error
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Peer represents a peer from admin_peers
type Peer struct {
	Enode     string                 `json:"enode"`
	Name      string                 `json:"name"`
	Network   *PeerNetwork           `json:"network"`
	Protocols map[string]interface{} `json:"protocols"`
}

// PeerNetwork represents peer network information
type PeerNetwork struct {
	Inbound       bool   `json:"inbound"`
	Trusted       bool   `json:"trusted"`
	RemoteAddress string `json:"remoteAddress"`
}

// PeerSummary represents peer analysis results
type PeerSummary struct {
	Total     int
	Protocols []string
	Clients   map[string]int
	Versions  map[string]int
	Inbound   int
	Outbound  int
	Trusted   int
}

// IPCClient handles IPC communication with geth/reth
type IPCClient struct {
	ipcPath         string
	conn            net.Conn
	requestID       int
	pendingRequests map[int]chan *JSONRPCResponse
	mu              sync.Mutex
}

// NewIPCClient creates a new IPC client
func NewIPCClient(ipcPath string) *IPCClient {
	return &IPCClient{
		ipcPath:         ipcPath,
		requestID:       1,
		pendingRequests: make(map[int]chan *JSONRPCResponse),
	}
}

// Connect establishes connection to the IPC socket
func (c *IPCClient) Connect() error {
	// Check if IPC socket exists
	if _, err := os.Stat(c.ipcPath); os.IsNotExist(err) {
		return fmt.Errorf("IPC socket not found at: %s", c.ipcPath)
	}

	conn, err := net.Dial("unix", c.ipcPath)
	if err != nil {
		return fmt.Errorf("failed to connect to IPC: %v", err)
	}

	c.conn = conn
	fmt.Printf("✅ Connected to geth IPC at: %s\n", c.ipcPath)

	// Start response handler
	go c.handleResponses()

	return nil
}

// handleResponses processes incoming JSON-RPC responses
func (c *IPCClient) handleResponses() {
	scanner := bufio.NewScanner(c.conn)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var response JSONRPCResponse
		if err := json.Unmarshal([]byte(line), &response); err != nil {
			fmt.Printf("Error parsing response: %v\n", err)
			continue
		}

		c.mu.Lock()
		if ch, exists := c.pendingRequests[response.ID]; exists {
			delete(c.pendingRequests, response.ID)
			c.mu.Unlock()
			ch <- &response
		} else {
			c.mu.Unlock()
		}
	}
}

// sendRequest sends a JSON-RPC request and waits for response
func (c *IPCClient) sendRequest(method string, params interface{}) (interface{}, error) {
	c.mu.Lock()
	id := c.requestID
	c.requestID++
	
	request := JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	responseCh := make(chan *JSONRPCResponse, 1)
	c.pendingRequests[id] = responseCh
	c.mu.Unlock()

	requestData, err := json.Marshal(request)
	if err != nil {
		c.mu.Lock()
		delete(c.pendingRequests, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	requestData = append(requestData, '\n')
	if _, err := c.conn.Write(requestData); err != nil {
		c.mu.Lock()
		delete(c.pendingRequests, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to write request: %v", err)
	}

	// Wait for response with timeout
	select {
	case response := <-responseCh:
		if response.Error != nil {
			return nil, fmt.Errorf("RPC error: %s", response.Error.Message)
		}
		return response.Result, nil
	case <-time.After(10 * time.Second):
		c.mu.Lock()
		delete(c.pendingRequests, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("request timeout for method: %s", method)
	}
}

// GetClientVersion gets client version via web3_clientVersion
func (c *IPCClient) GetClientVersion() (string, error) {
	result, err := c.sendRequest("web3_clientVersion", []interface{}{})
	if err != nil {
		return "", fmt.Errorf("failed to get client version: %v", err)
	}
	
	if version, ok := result.(string); ok {
		return version, nil
	}
	return "", fmt.Errorf("unexpected response type for client version")
}

// GetBlockNumber gets current block number via eth_blockNumber
func (c *IPCClient) GetBlockNumber() (int64, error) {
	result, err := c.sendRequest("eth_blockNumber", []interface{}{})
	if err != nil {
		return 0, fmt.Errorf("failed to get block number: %v", err)
	}
	
	if blockHex, ok := result.(string); ok {
		blockNum, err := strconv.ParseInt(strings.TrimPrefix(blockHex, "0x"), 16, 64)
		if err != nil {
			return 0, fmt.Errorf("failed to parse block number: %v", err)
		}
		return blockNum, nil
	}
	return 0, fmt.Errorf("unexpected response type for block number")
}

// GetPeerCount gets peer count via net_peerCount
func (c *IPCClient) GetPeerCount() (int, error) {
	result, err := c.sendRequest("net_peerCount", []interface{}{})
	if err != nil {
		return 0, fmt.Errorf("failed to get peer count: %v", err)
	}
	
	if peerCountHex, ok := result.(string); ok {
		peerCount, err := strconv.ParseInt(strings.TrimPrefix(peerCountHex, "0x"), 16, 32)
		if err != nil {
			return 0, fmt.Errorf("failed to parse peer count: %v", err)
		}
		return int(peerCount), nil
	}
	return 0, fmt.Errorf("unexpected response type for peer count")
}

// GetPeers gets all peers via admin_peers
func (c *IPCClient) GetPeers() ([]Peer, error) {
	result, err := c.sendRequest("admin_peers", []interface{}{})
	if err != nil {
		return nil, fmt.Errorf("failed to get peers: %v", err)
	}
	
	peerData, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal peer data: %v", err)
	}
	
	var peers []Peer
	if err := json.Unmarshal(peerData, &peers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal peers: %v", err)
	}
	
	return peers, nil
}

// GetAllInfo retrieves and displays basic client information
func (c *IPCClient) GetAllInfo() error {
	fmt.Println("📊 Fetching client information...\n")
	
	// Get information concurrently
	type infoResult struct {
		clientVersion string
		blockNumber   int64
		peerCount     int
		err           error
	}
	
	ch := make(chan infoResult, 3)
	
	go func() {
		version, err := c.GetClientVersion()
		ch <- infoResult{clientVersion: version, err: err}
	}()
	
	go func() {
		blockNum, err := c.GetBlockNumber()
		ch <- infoResult{blockNumber: blockNum, err: err}
	}()
	
	go func() {
		peerCount, err := c.GetPeerCount()
		ch <- infoResult{peerCount: peerCount, err: err}
	}()
	
	var clientVersion string
	var blockNumber int64
	var peerCount int
	
	for i := 0; i < 3; i++ {
		result := <-ch
		if result.err != nil {
			return fmt.Errorf("failed to retrieve information: %v", result.err)
		}
		
		if result.clientVersion != "" {
			clientVersion = result.clientVersion
		}
		if result.blockNumber != 0 {
			blockNumber = result.blockNumber
		}
		if result.peerCount != 0 {
			peerCount = result.peerCount
		}
	}
	
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("🔍 CLIENT INFORMATION")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Printf("📱 Client Version:    %s\n", clientVersion)
	fmt.Printf("🧱 Current Block:     %s\n", formatNumber(blockNumber))
	fmt.Printf("👥 Connected Peers:   %d\n", peerCount)
	fmt.Println(strings.Repeat("=", 60))
	
	return nil
}

// PeerSummary retrieves and displays peer summary statistics
func (c *IPCClient) PeerSummary() error {
	fmt.Println("📊 Fetching peer information...\n")
	
	peers, err := c.GetPeers()
	if err != nil {
		return err
	}
	
	if len(peers) == 0 {
		fmt.Println("❌ No peers connected")
		return nil
	}
	
	fmt.Println(strings.Repeat("=", 80))
	fmt.Println("👥 PEER SUMMARY")
	fmt.Println(strings.Repeat("=", 80))
	
	summary := c.analyzePeers(peers)
	
	fmt.Printf("📊 Total Peers:       %d\n", summary.Total)
	fmt.Printf("📡 Protocols:         %s\n", strings.Join(summary.Protocols, ", "))
	fmt.Printf("📥 Inbound:           %d\n", summary.Inbound)
	fmt.Printf("📤 Outbound:          %d\n", summary.Outbound)
	fmt.Printf("🔒 Trusted:           %d\n", summary.Trusted)
	fmt.Println()
	
	// Show client breakdown table
	if len(summary.Clients) > 0 {
		fmt.Println("🖥️  Client Types:")
		fmt.Println("┌─────────────────────────────┬───────┬─────────┐")
		fmt.Println("│ Client                      │ Count │ Percent │")
		fmt.Println("├─────────────────────────────┼───────┼─────────┤")
		
		// Sort clients by count
		type clientCount struct {
			name  string
			count int
		}
		var sortedClients []clientCount
		for name, count := range summary.Clients {
			sortedClients = append(sortedClients, clientCount{name, count})
		}
		sort.Slice(sortedClients, func(i, j int) bool {
			return sortedClients[i].count > sortedClients[j].count
		})
		
		for _, client := range sortedClients {
			percentage := float64(client.count) / float64(summary.Total) * 100
			fmt.Printf("│ %-27s │ %5d │ %6.1f%% │\n", 
				truncateString(client.name, 27), client.count, percentage)
		}
		
		fmt.Println("└─────────────────────────────┴───────┴─────────┘")
		fmt.Println()
	}
	
	// Show version breakdown table
	if len(summary.Versions) > 0 {
		fmt.Println("📦 Client Versions:")
		fmt.Println("┌──────────────────────────────────────────────────────────────────────┬───────┬─────────┐")
		fmt.Println("│ Version                                                              │ Count │ Percent │")
		fmt.Println("├──────────────────────────────────────────────────────────────────────┼───────┼─────────┤")
		
		// Sort versions by count
		type versionCount struct {
			version string
			count   int
		}
		var sortedVersions []versionCount
		for version, count := range summary.Versions {
			sortedVersions = append(sortedVersions, versionCount{version, count})
		}
		sort.Slice(sortedVersions, func(i, j int) bool {
			return sortedVersions[i].count > sortedVersions[j].count
		})
		
		for _, version := range sortedVersions {
			percentage := float64(version.count) / float64(summary.Total) * 100
			truncatedVersion := truncateString(version.version, 68)
			fmt.Printf("│ %-68s │ %5d │ %6.1f%% │\n", 
				truncatedVersion, version.count, percentage)
		}
		
		fmt.Println("└──────────────────────────────────────────────────────────────────────┴───────┴─────────┘")
	}
	
	return nil
}

// PeerList shows detailed list of all peers
func (c *IPCClient) PeerList() error {
	fmt.Println("📊 Fetching peer information...\n")
	
	peers, err := c.GetPeers()
	if err != nil {
		return err
	}
	
	if len(peers) == 0 {
		fmt.Println("❌ No peers connected")
		return nil
	}
	
	fmt.Println("📋 ALL PEER DETAILS")
	fmt.Println(strings.Repeat("=", 120))
	fmt.Println("Client\t\tEnode")
	fmt.Println(strings.Repeat("=", 120))
	
	for _, peer := range peers {
		enode := peer.Enode
		if enode == "" {
			enode = "Unknown"
		}
		
		name := peer.Name
		if name == "" {
			name = "Unknown"
		}
		
		fmt.Printf("%s\t\t%s\n", name, enode)
	}
	
	fmt.Println(strings.Repeat("=", 120))
	fmt.Printf("Total: %d peers\n", len(peers))
	
	return nil
}

// PeerPurgeDryRun analyzes which peers would be removed
func (c *IPCClient) PeerPurgeDryRun() error {
	fmt.Println("📊 Analyzing peers for removal...\n")
	
	peers, err := c.GetPeers()
	if err != nil {
		return err
	}
	
	if len(peers) == 0 {
		fmt.Println("❌ No peers connected")
		return nil
	}
	
	var toRemove, toKeep []Peer
	
	for _, peer := range peers {
		clientName := peer.Name
		if clientName == "" {
			clientName = "Unknown"
		}
		
		isWhitelisted := false
		for _, allowed := range AllowedClients {
			if strings.Contains(clientName, allowed) {
				isWhitelisted = true
				break
			}
		}
		
		if !isWhitelisted {
			toRemove = append(toRemove, peer)
		} else {
			toKeep = append(toKeep, peer)
		}
	}
	
	fmt.Println(strings.Repeat("=", 80))
	fmt.Println("🧹 PEER PURGE DRY RUN")
	fmt.Println(strings.Repeat("=", 80))
	fmt.Printf("📊 Total Peers:       %d\n", len(peers))
	fmt.Printf("✅ To Keep:           %d (%.1f%%)\n", 
		len(toKeep), float64(len(toKeep))/float64(len(peers))*100)
	fmt.Printf("❌ To Remove:         %d (%.1f%%)\n", 
		len(toRemove), float64(len(toRemove))/float64(len(peers))*100)
	fmt.Println()
	
	if len(toRemove) > 0 {
		fmt.Println("❌ Peers to be removed:")
		clientCounts := make(map[string]int)
		for _, peer := range toRemove {
			clientName := peer.Name
			if clientName == "" {
				clientName = "Unknown"
			}
			clientCounts[clientName]++
		}
		
		// Sort by count
		type clientCount struct {
			name  string
			count int
		}
		var sortedClients []clientCount
		for name, count := range clientCounts {
			sortedClients = append(sortedClients, clientCount{name, count})
		}
		sort.Slice(sortedClients, func(i, j int) bool {
			return sortedClients[i].count > sortedClients[j].count
		})
		
		for _, client := range sortedClients {
			fmt.Printf("   %s: %d peers\n", client.name, client.count)
		}
	}
	
	fmt.Println(strings.Repeat("=", 80))
	
	return nil
}

// PeerPurge removes unwanted peers
func (c *IPCClient) PeerPurge() error {
	fmt.Println("📊 Analyzing and removing unwanted peers...\n")
	
	peers, err := c.GetPeers()
	if err != nil {
		return err
	}
	
	if len(peers) == 0 {
		fmt.Println("❌ No peers connected")
		return nil
	}
	
	var toRemove []Peer
	for _, peer := range peers {
		clientName := peer.Name
		if clientName == "" {
			clientName = "Unknown"
		}
		
		isWhitelisted := false
		for _, allowed := range AllowedClients {
			if strings.Contains(clientName, allowed) {
				isWhitelisted = true
				break
			}
		}
		
		if !isWhitelisted {
			toRemove = append(toRemove, peer)
		}
	}
	
	fmt.Println(strings.Repeat("=", 80))
	fmt.Println("🧹 PEER PURGE (LIVE)")
	fmt.Println(strings.Repeat("=", 80))
	fmt.Printf("📊 Total Peers:       %d\n", len(peers))
	fmt.Printf("❌ Removing:          %d\n", len(toRemove))
	fmt.Println()
	
	var removed []Peer
	for _, peer := range toRemove {
		if peer.Enode != "" {
			remoteAddr := "unknown"
			if peer.Network != nil && peer.Network.RemoteAddress != "" {
				remoteAddr = peer.Network.RemoteAddress
			}
			
			fmt.Printf("🗑️  Removing: %s (%s)\n", peer.Name, remoteAddr)
			_, err := c.sendRequest("admin_removePeer", []interface{}{peer.Enode})
			if err != nil {
				fmt.Printf("❌ Failed to remove %s: %v\n", peer.Name, err)
			} else {
				removed = append(removed, peer)
			}
		}
	}
	
	fmt.Println()
	fmt.Printf("✅ Successfully removed %d peers\n", len(removed))
	fmt.Println(strings.Repeat("=", 80))
	
	return nil
}

// analyzePeers analyzes peer statistics
func (c *IPCClient) analyzePeers(peers []Peer) PeerSummary {
	summary := PeerSummary{
		Total:    len(peers),
		Clients:  make(map[string]int),
		Versions: make(map[string]int),
	}
	
	protocolSet := make(map[string]bool)
	
	for _, peer := range peers {
		// Extract protocols
		if peer.Protocols != nil {
			for protocol := range peer.Protocols {
				protocolSet[protocol] = true
			}
		}
		
		// Extract client types and versions
		if peer.Name != "" {
			parts := strings.Split(peer.Name, "/")
			if len(parts) > 0 {
				clientName := parts[0]
				summary.Clients[clientName]++
			}
			
			// Track full client version strings
			summary.Versions[peer.Name]++
		}
		
		// Connection direction
		if peer.Network != nil {
			if peer.Network.Inbound {
				summary.Inbound++
			} else {
				summary.Outbound++
			}
			
			if peer.Network.Trusted {
				summary.Trusted++
			}
		}
	}
	
	// Convert protocol set to slice
	for protocol := range protocolSet {
		summary.Protocols = append(summary.Protocols, protocol)
	}
	sort.Strings(summary.Protocols)
	
	return summary
}

// Disconnect closes the IPC connection
func (c *IPCClient) Disconnect() {
	if c.conn != nil {
		c.conn.Close()
	}
}

// Helper functions

func formatNumber(n int64) string {
	s := strconv.FormatInt(n, 10)
	if len(s) <= 3 {
		return s
	}
	
	result := ""
	for i, digit := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			result += ","
		}
		result += string(digit)
	}
	return result
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

func showUsage() {
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  ./peer-filter [command] [ipc-path]")
	fmt.Println("  IPC_SOCKET=/path/to/socket.ipc ./peer-filter [command]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  info (default)         - Show client version, block number, and peer count")
	fmt.Println("  peer-summary           - Show peer statistics and client breakdown")
	fmt.Println("  peer-list             - Show full enode and client details for all peers")
	fmt.Println("  peer-purge-dry-run    - Show how many peers would be removed by filter")
	fmt.Println("  peer-purge            - Remove unwanted peers based on whitelist filter")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  ./peer-filter /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc")
	fmt.Println("  ./peer-filter peer-summary /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc")
	fmt.Println("  IPC_SOCKET=/storage/berabox/installations/bb-mainnet-reth/runtime/ipc/reth.ipc ./peer-filter peer-purge-dry-run")
}

func main() {
	args := os.Args[1:]
	
	// Parse command and IPC path
	command := "info"
	ipcPath := os.Getenv("IPC_SOCKET")
	
	if len(args) == 1 {
		// Either command or ipc-path
		if strings.Contains(args[0], "/") || strings.Contains(args[0], "\\") {
			ipcPath = args[0]
		} else {
			command = args[0]
		}
	} else if len(args) == 2 {
		// command and ipc-path
		command = args[0]
		ipcPath = args[1]
	} else if len(args) == 0 && ipcPath == "" {
		// No args and no env var
		showUsage()
		os.Exit(1)
	}
	
	if ipcPath == "" {
		fmt.Println("❌ Error: IPC path is required")
		showUsage()
		os.Exit(1)
	}
	
	// Validate command
	validCommands := []string{"info", "peer-summary", "peer-list", "peer-purge-dry-run", "peer-purge"}
	validCommand := false
	for _, valid := range validCommands {
		if command == valid {
			validCommand = true
			break
		}
	}
	
	if !validCommand {
		fmt.Printf("❌ Error: Invalid command '%s'\n", command)
		fmt.Printf("Valid commands: %s\n", strings.Join(validCommands, ", "))
		os.Exit(1)
	}
	
	client := NewIPCClient(ipcPath)
	
	if err := client.Connect(); err != nil {
		fmt.Printf("❌ Error: %v\n", err)
		os.Exit(1)
	}
	defer client.Disconnect()
	
	var err error
	switch command {
	case "peer-summary":
		err = client.PeerSummary()
	case "peer-list":
		err = client.PeerList()
	case "peer-purge-dry-run":
		err = client.PeerPurgeDryRun()
	case "peer-purge":
		err = client.PeerPurge()
	default:
		err = client.GetAllInfo()
	}
	
	if err != nil {
		fmt.Printf("❌ Error: %v\n", err)
		os.Exit(1)
	}
}
