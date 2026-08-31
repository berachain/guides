.PHONY: test
test:
	cd apps/staking-pools/install-helpers && node --test test/*.test.mjs
