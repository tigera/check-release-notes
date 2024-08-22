
.PHONY: build

build: dist/index.js

dist/index.js: index.js
	@ncc build index.js --license license.txt
