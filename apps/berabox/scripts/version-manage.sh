#!/bin/bash

# Berabox Version Management Script
# Handles version-related operations for installations

set -e

# Source common functions and configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"
source "$SCRIPT_DIR/common.sh"

# Version management functions
show_tags() {
    local installation="$1"
    
    log_info "Showing available Git tags for installation: $installation"
    
    # Get installation directory and source paths
    local installation_dir="$BB_CONFIG_INSTALLATIONS_DIR/$installation"
    local installation_toml="$installation_dir/installation.toml"
    
    if [[ ! -f "$installation_toml" ]]; then
        log_error "Installation configuration not found: $installation_toml"
        return 1
    fi
    
    # Determine which EL client this installation uses
    local el_client=$(bb_parse_toml_value "$installation_toml" "el_client")
    if [[ -z "$el_client" ]]; then
        log_error "Could not determine EL client from installation.toml"
        return 1
    fi
    
    # Show beacon-kit tags
    local beacon_kit_dir="$installation_dir/src/beacon-kit"
    if [[ -d "$beacon_kit_dir" ]]; then
        echo "=== Beacon Kit (CL) Tags ==="
        log_info "Refreshing beacon-kit git tags..."
        bb_git_refresh_refs "$beacon_kit_dir" || log_warn "Proceeding with local refs for beacon-kit"
        cd "$beacon_kit_dir" && git tag --sort=-version:refname | head -10
        echo ""
    else
        log_warn "Beacon-kit source directory not found: $beacon_kit_dir"
    fi
    
    # Show EL client tags
    local el_client_dir=""
    case "$el_client" in
        "reth")
            el_client_dir="$installation_dir/src/bera-reth"
            echo "=== Bera-Reth (EL) Tags ==="
            ;;
        "geth")
            el_client_dir="$installation_dir/src/bera-geth"
            echo "=== Bera-Geth (EL) Tags ==="
            ;;
        *)
            log_error "Unsupported EL client: $el_client"
            return 1
            ;;
    esac
    
    if [[ -d "$el_client_dir" ]]; then
        log_info "Refreshing ${el_client} git tags..."
        bb_git_refresh_refs "$el_client_dir" || log_warn "Proceeding with local refs for $el_client"
        cd "$el_client_dir" && git tag --sort=-version:refname | head -10
        echo ""
    else
        log_warn "${el_client^} source directory not found: $el_client_dir"
    fi
    
    echo "Note: Only showing the 10 most recent tags. Use 'git tag' in the source directory for all tags."
}

set_versions() {
    local installation="$1"
    shift
    
    log_info "Setting component versions for installation: $installation"
    
    # Parse version set arguments
    local cl_version=""
    local el_version=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --cl)
                cl_version="$2"
                shift 2
                ;;
            --el)
                el_version="$2"
                shift 2
                ;;
            *)
                log_error "Unknown version option: $1"
                echo "Usage: $0 set $installation --cl <version> --el <version>"
                return 1
                ;;
        esac
    done
    
    if [[ -z "$cl_version" && -z "$el_version" ]]; then
        log_error "At least one version must be specified (--cl or --el)"
        echo "Usage: $0 set $installation --cl <version> --el <version>"
        return 1
    fi
    
    # Update installation.toml with new versions
    local installation_dir="$BB_CONFIG_INSTALLATIONS_DIR/$installation"
    local installation_toml="$installation_dir/installation.toml"
    
    if [[ ! -f "$installation_toml" ]]; then
        log_error "Installation configuration not found: $installation_toml"
        return 1
    fi
    
    # Update CL version if specified
    if [[ -n "$cl_version" ]]; then
        if sed -i "s/^beacon_kit = \".*\"/beacon_kit = \"$cl_version\"/" "$installation_toml"; then
            log_info "Updated beacon_kit version to: $cl_version"
        else
            log_error "Failed to update beacon_kit version"
            return 1
        fi
    fi
    
    # Update EL version if specified
    if [[ -n "$el_version" ]]; then
        # Determine which EL client this installation uses
        local el_client=$(bb_parse_toml_value "$installation_toml" "el_client")
        if [[ -z "$el_client" ]]; then
            log_error "Could not determine EL client from installation.toml"
            return 1
        fi
        
        local version_key=""
        case "$el_client" in
            "reth")
                version_key="bera_reth"
                ;;
            "geth")
                version_key="bera_geth"
                ;;
            *)
                log_error "Unsupported EL client: $el_client"
                return 1
                ;;
        esac
        
        if sed -i "s/^${version_key} = \".*\"/${version_key} = \"$el_version\"/" "$installation_toml"; then
            log_info "Updated ${version_key} version to: $el_version"
        else
            log_error "Failed to update ${version_key} version"
            return 1
        fi
    fi
    
    log_info "Version update complete. Run 'build' to rebuild with new versions."
}

show_usage() {
    echo "Berabox Version Management"
    echo ""
    echo "Usage: $0 <action> <installation> [options]"
    echo ""
    echo "Actions:"
    echo "  show-tags <installation>                    Show available Git tags and branches"
    echo "  set <installation> --cl <ver> --el <ver>    Set component versions"
    echo ""
    echo "Examples:"
    echo "  $0 show-tags bb-mainnet-reth"
    echo "  $0 set bb-mainnet-reth --cl v1.3.1 --el v1.0.1"
    echo "  $0 set bb-mainnet-geth --cl main --el v1.16.2"
}

# Main script logic
main() {
    if [[ $# -eq 0 ]]; then
        show_usage
        exit 1
    fi
    
    local action="$1"
    shift
    
    case "$action" in
        "show-tags")
            if [[ $# -eq 0 ]]; then
                log_error "Installation name required"
                show_usage
                exit 1
            fi
            show_tags "$1"
            ;;
        "set")
            if [[ $# -eq 0 ]]; then
                log_error "Installation name required"
                show_usage
                exit 1
            fi
            set_versions "$@"
            ;;
        "help"|"--help"|"-h")
            show_usage
            ;;
        *)
            log_error "Unknown action: $action"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
