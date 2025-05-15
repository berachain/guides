# Contributing to Berachain Guides

Thanks for your interest in contributing to Berachain Guides! This document provides guidelines and standards for adding new guides or improving existing ones.

## Guide Structure

Each guide should be placed in the `apps/` directory and follow this structure:

```
apps/your-guide-name/
├── README.md           # Setup and quick start
├── WALKTHROUGH.md      # Detailed process explanation
├── contracts/          # Smart contracts (if applicable)
├── scripts/           # Deployment/interaction scripts
├── .env.example       # Example environment variables
└── package.json       # Dependencies and scripts
```

## Documentation Standards

### README.md

- Clear prerequisites
- Step-by-step setup instructions
- Project structure
- Common issues and solutions
- Network details
- Links to additional resources

### WALKTHROUGH.md

- Detailed process explanation
- Code snippets with context
- Example outputs
- Troubleshooting guide
- Next steps

## Code Standards

1. **Dependencies**

   - Use `@branch/berachain-config` for network configuration
   - Keep dependencies up to date
   - Document any special requirements

2. **Scripts**

   - Include clear error handling
   - Add helpful console output
   - Document all environment variables

3. **Contracts**
   - Include NatSpec comments
   - Follow Solidity style guide
   - Add test cases where applicable

## Pull Request Process

1. Create a new branch from `main`
2. Follow the PR template
3. Ensure all tests pass
4. Update documentation as needed
5. Get at least one review before merging

## Adding a New Guide

1. Create a new directory in `apps/`
2. Follow the guide structure above
3. Use existing guides as templates
4. Test the guide end-to-end
5. Submit a PR with the template

## Questions?

Feel free to open an issue or reach out to the team!
