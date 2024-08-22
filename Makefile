
.PHONY: build lint

build: dist/index.js 

lint: node_modules
	$(info Running eslint...)
	@npx eslint index.js

node_modules:
	$(info Running `npm install`)
	@npm install

dist/index.js: index.js lint
	@ncc build index.js --license license.txt
