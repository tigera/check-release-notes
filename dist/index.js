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

// This action deliberately has no runtime dependencies. It only needed a few
// helpers from @actions/core, and that package pulls in an HTTP client
// (@actions/http-client -> undici) that this action never calls: roughly 1MB
// of unreachable network code, carrying its own advisories, bundled into every
// run against a private PR. The helpers are reimplemented below against the
// documented runner contract.

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

// Property values sit inside the command's parameter list, so ':' and ',' need
// encoding on top of the data escapes or they would end the value early.
function escapeCommandProperty(value) {
    return escapeCommandData(value)
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}

// The annotation title becomes the heading GitHub shows above the message in
// the Checks tab. Without it every annotation is headed with a bare "Error".
// It has no effect on the "Failing after 3s" line on the PR page: that text
// belongs to the workflow's own check run and the runner owns it.
function annotate(kind, message, title) {
    const properties = title ? ' title=' + escapeCommandProperty(title) : '';
    process.stdout.write('::' + kind + properties + '::' + escapeCommandData(message) + '\n');
}

// Failing the step is the fallback route, taken only when the "Release notes"
// check run could not be created. Nothing else left can block the pull request.
function setFailed(message, title) {
    annotate('error', message, title);
    process.exitCode = 1;
}

// Markdown appended to $GITHUB_STEP_SUMMARY is rendered on the run's summary
// page, one click behind the "Details" link on the PR. It is the only place
// this action can put more than a single line of text, so the failure cases
// spend that room on an example the author can copy.
function writeSummary(markdown) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) {
        // Older runners, and act, do not provide the file.
        return;
    }
    try {
        fs.appendFileSync(summaryPath, markdown + '\n');
    } catch (error) {
        // The summary is a nicety. Failing to write one must not change the
        // verdict the check reports.
        console.log('Could not write the job summary: ' + error.message);
    }
}

const FENCE_START = '```release-note';
const FENCE_END = '```';

// Four backticks so the three-backtick fence inside renders literally.
const EXAMPLE = [
    'Add a block like this to the pull request description:',
    '',
    '````',
    FENCE_START,
    'Fixed a panic when the config file was empty.',
    FENCE_END,
    '````',
].join('\n');
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
// failure describes the first block, which is the one the author most likely
// meant to fill in. Returns null on success, or a {title, message} pair: the
// title heads the annotation, the message says what to do about it.
function validate(blocks, labelName) {
    if (blocks.length === 0) {
        return {
            title: 'No release notes',
            message: 'No release notes found in PR body',
        };
    }

    const kinds = blocks.map(classify);
    if (kinds.includes('note')) {
        return null;
    }

    switch (kinds[0]) {
        case 'placeholder':
            return {
                title: 'Release notes are still a placeholder',
                message: 'Release notes are still a placeholder. Replace it with an actual release note.',
            };
        case 'negation':
            return {
                title: 'Release notes say no note is needed',
                message: 'Release notes say no note is needed, which is not a release note. ' +
                    'Write an actual release note, or remove the ' + labelName + ' label from this PR.',
            };
        default:
            return {
                title: 'Release notes are empty',
                message: 'Release notes are empty',
            };
    }
}

// The runner owns the "Failing after 3s" line under the workflow's own check
// run, and nothing the action prints can change it. A check run this action
// creates itself does have a line the action controls: its output title. That
// is what puts the reason on the PR page without anyone opening Details.
//
// So this check run, not the step's exit code, is where a failure is reported
// whenever it can be created. Creating it needs a token with checks: write,
// which is not available on a pull_request event from a fork; when that fails
// the reason is logged and the step falls back to exiting non-zero. Either way
// the verdict comes from the validation above, never from whether GitHub
// accepted this call.
const CHECK_NAME = 'Release notes';
const CHECK_RUN_TIMEOUT_MS = 10000;

function skipReason(status) {
    switch (status) {
        case 401:
            return 'The token is invalid or has expired.';
        case 403:
            return 'The token is read-only, which is what a pull_request event from a fork ' +
                'gets. Use pull_request_target if the check run is needed on fork PRs.';
        case 404:
            return 'The token is missing checks: write, or cannot see this repository.';
        case 422:
            return 'GitHub rejected the check run; the head SHA may not belong to this repository.';
        default:
            return '';
    }
}

function skipped(detail) {
    console.log('Skipped the "' + CHECK_NAME + '" check run: ' + detail);
    return false;
}

// Returns true only once GitHub has accepted the check run, because the caller
// decides whether to fail the step on the strength of that answer.
async function createCheckRun(report, headSha) {
    const token = getInput('github-token') || process.env.GITHUB_TOKEN || '';
    if (!token) {
        return skipped('no github-token was supplied. Pass one and grant checks: write ' +
            'to show the reason on the pull request page itself.');
    }
    if (!process.env.GITHUB_REPOSITORY) {
        return skipped('GITHUB_REPOSITORY is not set.');
    }
    if (!headSha) {
        return skipped('the event payload has no head SHA.');
    }

    const url = (process.env.GITHUB_API_URL || 'https://api.github.com') +
        '/repos/' + process.env.GITHUB_REPOSITORY + '/check-runs';

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'authorization': 'Bearer ' + token,
                'accept': 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'content-type': 'application/json',
                'user-agent': 'check-release-notes',
            },
            body: JSON.stringify({
                name: CHECK_NAME,
                head_sha: headSha,
                status: 'completed',
                conclusion: report.conclusion,
                // The title is the line GitHub shows beside the check name on
                // the pull request page.
                output: { title: report.title, summary: report.summary },
            }),
            signal: AbortSignal.timeout(CHECK_RUN_TIMEOUT_MS),
        });
    } catch (error) {
        // Offline runner, blocked egress, DNS failure, or the timeout above.
        return skipped('the request to GitHub failed (' + error.message + ').');
    }

    if (!response.ok) {
        return skipped('GitHub answered HTTP ' + response.status + '. ' + skipReason(response.status));
    }

    console.log('Reported "' + report.title + '" on the "' + CHECK_NAME + '" check run.');
    return true;
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

// One report drives all three outputs: the annotation, the job summary, and
// the check run. They stay in step because they are built from the same object.
function report(pullRequest, labelName) {
    const labelNames = (pullRequest.labels || []).map(item => item.name);

    if (!labelNames.includes(labelName)) {
        console.log('Label ' + labelName + ' not present, skipping validation');
        return {
            conclusion: 'success',
            title: 'No release note required',
            summary: '## Release notes: passed\n\nThe `' + labelName +
                '` label is not present, so no release note is required.',
        };
    }

    const failure = validate(findReleaseNoteBlocks(pullRequest.body), labelName);

    if (!failure) {
        console.log('No errors detected in release notes.');
        return {
            conclusion: 'success',
            title: 'Release note found',
            summary: '## Release notes: passed\n\n' +
                'A release note was found in the pull request description.',
        };
    }

    // A draft is still being written, so it is reported but not enforced.
    if (pullRequest.draft === true) {
        console.log('[draft] PR contained the following issue: ' + failure.message);
        return {
            conclusion: 'neutral',
            title: 'Not enforced while this pull request is a draft',
            summary: '## Release notes: not enforced (draft)\n\n' +
                '**' + failure.title + '**\n\n' + failure.message + '\n\n' +
                'This pull request is a draft, so the check is not failing. ' +
                'It will fail once the pull request is ready for review.\n\n' + EXAMPLE,
        };
    }

    return {
        conclusion: 'failure',
        title: failure.title,
        message: failure.message,
        summary: '## Release notes: failed\n\n' +
            '**' + failure.title + '**\n\n' + failure.message + '\n\n' + EXAMPLE,
    };
}

async function main() {
    let pullRequest = null;
    let result;

    try {
        const labelName = getInput('label-name');
        pullRequest = readPullRequest();
        result = report(pullRequest, labelName);
    } catch (error) {
        result = {
            conclusion: 'failure',
            title: 'Release notes check could not run',
            message: error.message,
            summary: '## Release notes: could not run\n\n' + error.message,
        };
    }

    writeSummary(result.summary);
    const reported = await createCheckRun(
        result, pullRequest && pullRequest.head && pullRequest.head.sha);

    if (result.conclusion !== 'failure') {
        return;
    }

    // A failure has to land on a check the pull request can be blocked on. The
    // check run is the better of the two, because its title puts the reason on
    // the PR page, while this job's own line reads "Failing after 3s" whatever
    // it does. So the step exits non-zero only when that check run is missing.
    if (reported) {
        annotate('notice', result.message, result.title);
        console.log('The "' + CHECK_NAME + '" check run carries this failure, so this job ' +
            'succeeds. Make "' + CHECK_NAME + '" a required check for it to block merges.');
        return;
    }

    console.log('Failing this job instead, because there is nothing else left to report on.');
    setFailed(result.message, result.title);
}

// Nothing in main() is expected to reject, but an unhandled rejection would
// end the process without an annotation explaining why.
main().catch(error => setFailed(error.message, 'Release notes check could not run'));

module.exports = __webpack_exports__;
/******/ })()
;