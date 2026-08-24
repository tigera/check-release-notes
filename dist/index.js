/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const fs = __nccwpck_require__(896);

// This action deliberately has no runtime dependencies. It only needed two
// helpers from @actions/core, and that package pulls in an HTTP client
// (@actions/http-client -> undici) that this action never calls: roughly 1MB
// of unreachable network code, carrying its own advisories, bundled into every
// run against a private PR. The two helpers are reimplemented below against
// the documented runner contract.

// Inputs arrive as INPUT_<NAME>, upper-cased with spaces turned into
// underscores. Hyphens are left alone, so 'label-name' is INPUT_LABEL-NAME.
function getInput(name) {
    const value = process.env['INPUT_' + name.replace(/ /g, '_').toUpperCase()] || '';
    return value.trim();
}

// Workflow commands are newline-delimited, so any literal '%', CR or LF in the
// message has to be percent-encoded or it would terminate the command early.
function escapeCommandData(value) {
    return String(value)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}

function setFailed(message) {
    process.stdout.write('::error::' + escapeCommandData(message) + '\n');
    process.exitCode = 1;
}

const FENCE_START = '```release-note';
const FENCE_END = '```';
const COMMENT_START = '<!--';
const COMMENT_END = '-->';

// The only valid entry is an actual release note. Two kinds of non-note get
// their own message so the author knows what to do about it.

// The author has not written the note yet.
const PLACEHOLDERS = ['TBD', 'TODO', 'FIXME', 'XXX', 'WIP', 'PENDING'];

// The author is saying no release note is needed. That is a statement about
// the label, not a release note, so it fails and points at the label instead.
const NEGATIONS = [
    'NONE', 'N/A', 'NA', 'NIL', 'NO', 'NOPE', 'NOTHING',
    'NOT APPLICABLE', 'NOT NEEDED', 'NOT REQUIRED',
    'NO RELEASE NOTE', 'NO RELEASE NOTES',
    'NO RELEASE NOTE NEEDED', 'NO RELEASE NOTES NEEDED',
    'NO RELEASE NOTE REQUIRED', 'NO RELEASE NOTES REQUIRED',
];

// Remove HTML comments so that a commented-out block from the PR template is
// never mistaken for real release notes. Uses indexOf rather than a regex so
// the cost stays linear in the length of the body.
function stripHtmlComments(body) {
    let out = '';
    let pos = 0;

    for (;;) {
        const start = body.indexOf(COMMENT_START, pos);
        if (start === -1) {
            return out + body.slice(pos);
        }
        out += body.slice(pos, start);

        const end = body.indexOf(COMMENT_END, start + COMMENT_START.length);
        if (end === -1) {
            // An unterminated comment swallows the rest of the body, which is
            // how GitHub renders it too.
            return out;
        }
        pos = end + COMMENT_END.length;
    }
}

// Collect the contents of every ```release-note block in the body. indexOf
// keeps this linear; the previous lookbehind/lookahead regex backtracked
// cubically on an unclosed fence followed by whitespace.
function findReleaseNoteBlocks(body) {
    if (typeof body !== 'string') {
        return [];
    }

    const text = stripHtmlComments(body);
    const blocks = [];
    let pos = 0;

    for (;;) {
        const start = text.indexOf(FENCE_START, pos);
        if (start === -1) {
            return blocks;
        }

        const contentStart = start + FENCE_START.length;
        const end = text.indexOf(FENCE_END, contentStart);
        if (end === -1) {
            // Unclosed fence, so there is no complete block to read.
            return blocks;
        }

        blocks.push(text.slice(contentStart, end).trim());
        pos = end + FENCE_END.length;
    }
}

// Collapse whitespace and strip surrounding punctuation so that "TBD.",
// "- none -" and "No release note needed!" all reduce to a comparable form.
// The comparison is against the whole entry, never a substring, so a real note
// that happens to start with "None of ..." is untouched.
function normalise(notes) {
    return notes
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/^\W+|\W+$/g, '')
        .trim();
}

function classify(notes) {
    const normalised = normalise(notes);
    if (normalised === '') {
        return 'empty';
    }
    if (PLACEHOLDERS.includes(normalised)) {
        return 'placeholder';
    }
    if (NEGATIONS.includes(normalised)) {
        return 'negation';
    }
    return 'note';
}

// A block counts as valid only if it holds a real note, so a PR that leaves a
// stale "TBD" above its actual notes still passes. When nothing is valid, the
// message describes the first block, which is the one the author most likely
// meant to fill in.
function validate(blocks, labelName) {
    if (blocks.length === 0) {
        return 'No release notes found in PR body';
    }

    const kinds = blocks.map(classify);
    if (kinds.includes('note')) {
        return '';
    }

    switch (kinds[0]) {
        case 'placeholder':
            return 'Release notes are still a placeholder. Replace it with an actual release note.';
        case 'negation':
            return 'Release notes say no note is needed, which is not a release note. ' +
                'Write an actual release note, or remove the ' + labelName + ' label from this PR.';
        default:
            return 'Release notes are empty';
    }
}

function readPullRequest() {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        throw new Error('GITHUB_EVENT_PATH is not set; this action must run in GitHub Actions');
    }

    const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (!payload.pull_request) {
        throw new Error('No pull_request in the event payload; this action requires a pull_request event');
    }
    return payload.pull_request;
}

try {
    const labelName = getInput('label-name');
    const pullRequest = readPullRequest();
    const labelNames = (pullRequest.labels || []).map(item => item.name);

    let failureMessage = '';

    if (labelNames.includes(labelName)) {
        failureMessage = validate(findReleaseNoteBlocks(pullRequest.body), labelName);
    } else {
        console.log('Label ' + labelName + ' not present, skipping validation');
    }

    if (failureMessage !== '') {
        if (pullRequest.draft === true) {
            console.log('[draft] PR contained the following issue: ' + failureMessage);
        } else {
            setFailed('An error was found: ' + failureMessage);
        }
    } else {
        console.log('No errors detected in release notes.');
    }

} catch (error) {
    setFailed(error.message);
}

module.exports = __webpack_exports__;
/******/ })()
;