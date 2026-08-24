
.PHONY: build lint test

# Always use the pinned binaries from node_modules. Resolving these through
# npx or $PATH can pick up a different globally installed version, which
# changes the bytes of dist/index.js and makes the bundle look tampered with.
ESLINT := ./node_modules/.bin/eslint
NCC := ./node_modules/.bin/ncc

build: lint dist/index.js

lint: node_modules
	$(info Running eslint...)
	@$(ESLINT) index.js test.js

test: build
	$(info Running tests...)
	@node test.js

node_modules: package-lock.json
	$(info Running `npm ci`)
	@npm ci

dist/index.js: node_modules index.js
	@$(NCC) build index.js
