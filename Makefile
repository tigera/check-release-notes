
.PHONY: build lint

build: lint dist/index.js 

lint: node_modules
	$(info Running eslint...)
	@npx eslint index.js

node_modules:
	$(info Running `npm install`)
	@npm install

dist/index.js: node_modules index.js
	@ncc build index.js --license license.txt
