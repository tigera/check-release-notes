// Runs dist/index.js the way the runner does: a real child process with
// GITHUB_EVENT_PATH pointing at an event payload and the input passed as
// INPUT_LABEL-NAME. Testing the bundle rather than the source means these
// cases also prove the committed dist behaves correctly.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TARGET = process.argv[2] || path.join(__dirname, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-notes-'));
const eventPath = path.join(tmp, 'event.json');
const summaryPath = path.join(tmp, 'summary.md');

let failures = 0;

function run(payload, { label = 'release-note-required', env = {} } = {}) {
    fs.writeFileSync(eventPath, JSON.stringify(payload));
    // The runner hands each step an empty file and reads it back afterwards.
    fs.writeFileSync(summaryPath, '');
    const start = process.hrtime.bigint();
    let code = 0;
    let out = '';

    // A GITHUB_TOKEN inherited from the developer's shell would send these
    // runs at the real API, so the status credentials are always explicit.
    const childEnv = {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        'INPUT_LABEL-NAME': label,
    };
    delete childEnv.GITHUB_TOKEN;
    delete childEnv['INPUT_GITHUB-TOKEN'];
    delete childEnv.GITHUB_API_URL;
    delete childEnv.GITHUB_REPOSITORY;
    // Set when these tests are themselves run by Actions, where they would
    // otherwise leak the outer run's URL into the status under test.
    delete childEnv.GITHUB_SERVER_URL;
    delete childEnv.GITHUB_RUN_ID;
    Object.assign(childEnv, env);

    try {
        out = execFileSync('node', [TARGET], {
            env: childEnv,
            encoding: 'utf8',
            timeout: 60000,
        });
    } catch (error) {
        code = error.status === undefined ? 'TIMEOUT' : error.status;
        out = (error.stdout || '') + (error.stderr || '');
    }
    return {
        code,
        out: out.trim(),
        summary: fs.readFileSync(summaryPath, 'utf8'),
        ms: Number(process.hrtime.bigint() - start) / 1e6,
    };
}

function check(name, payload, expected, options = {}) {
    const result = run(payload, options);
    const maxMs = options.maxMs || 10000;
    const ok = result.code === expected.code &&
        result.out.includes(expected.contains) &&
        (expected.excludes === undefined || !result.out.includes(expected.excludes)) &&
        (expected.summaryContains === undefined || result.summary.includes(expected.summaryContains)) &&
        result.ms <= maxMs;

    if (!ok) {
        failures++;
    }
    console.log(
        (ok ? 'PASS  ' : 'FAIL  ') + name +
        '  [exit=' + result.code + ' ' + result.ms.toFixed(0) + 'ms]' +
        (ok ? '' : '\n      expected exit=' + expected.code + ' containing ' +
            JSON.stringify(expected.contains) +
            (expected.excludes === undefined ? '' : ' and not ' + JSON.stringify(expected.excludes)) +
            ', got: ' + JSON.stringify(result.out.slice(0, 200))) +
        (ok || expected.summaryContains === undefined ? '' :
            '\n      expected summary containing ' + JSON.stringify(expected.summaryContains) +
            ', got: ' + JSON.stringify(result.summary.slice(0, 200)))
    );
}

const HEAD_SHA = '0d5eb4f1a2c3b4d5e6f708192a3b4c5d6e7f8091';

const pr = (body, extra = {}) => ({
    pull_request: {
        labels: [{ name: 'release-note-required' }],
        body,
        draft: false,
        head: { sha: HEAD_SHA },
        ...extra,
    },
});

const PASSED = { code: 0, contains: 'No errors detected' };
const MISSING = { code: 1, contains: 'No release notes found' };
const PLACEHOLDER = { code: 1, contains: 'still a placeholder' };
const NEGATION = { code: 1, contains: 'not a release note' };

// Label gating.
check('label absent skips validation',
    { pull_request: { labels: [{ name: 'other' }], body: '' } },
    { code: 0, contains: 'not present, skipping' });
check('missing labels key does not crash',
    { pull_request: { body: '', labels: undefined } },
    { code: 0, contains: 'not present, skipping' });

// Only an actual release note is accepted.
check('real notes pass', pr('```release-note\nFixed a real bug\n```'), PASSED);
check('multi-line notes pass',
    pr('```release-note\nFixed a real bug.\n\nAlso fixed a second one.\n```'), PASSED);

// Placeholders and empty blocks.
check('TBD fails', pr('```release-note\nTBD\n```'), PLACEHOLDER);
check('"TBD." fails', pr('```release-note\nTBD.\n```'), PLACEHOLDER);
check('lowercase "tbd:" fails', pr('```release-note\ntbd:\n```'), PLACEHOLDER);
check('TODO fails', pr('```release-note\nTODO\n```'), PLACEHOLDER);
check('WIP fails', pr('```release-note\nWIP\n```'), PLACEHOLDER);
check('empty block fails', pr('```release-note\n\n```'), { code: 1, contains: 'are empty' });

// Saying "no note needed" is a statement about the label, not a release note.
check('NONE fails', pr('```release-note\nNONE\n```'), NEGATION);
check('lowercase "none." fails', pr('```release-note\nnone.\n```'), NEGATION);
check('"- none -" fails', pr('```release-note\n- none -\n```'), NEGATION);
check('N/A fails', pr('```release-note\nN/A\n```'), NEGATION);
check('NA fails', pr('```release-note\nNA\n```'), NEGATION);
check('NIL fails', pr('```release-note\nnil\n```'), NEGATION);
check('"No release note needed" fails',
    pr('```release-note\nNo release note needed\n```'), NEGATION);
check('"not required" fails', pr('```release-note\nNot required.\n```'), NEGATION);
check('negation message names the label',
    pr('```release-note\nNONE\n```'),
    { code: 1, contains: 'remove the release-note-required label' });
check('negation message names a custom label',
    { pull_request: { labels: [{ name: 'needs-note' }], body: '```release-note\nNONE\n```', draft: false } },
    { code: 1, contains: 'remove the needs-note label' }, { label: 'needs-note' });

// Matching is on the whole entry, so a real note that merely starts with a
// negative word must still pass.
check('"None of the defaults change" passes',
    pr('```release-note\nNone of the defaults change when upgrading.\n```'), PASSED);
check('"No longer panics" passes',
    pr('```release-note\nNo longer panics on an empty config.\n```'), PASSED);
check('"NA" inside a real note passes',
    pr('```release-note\nAdded NA region support.\n```'), PASSED);

// A real note anywhere in the body wins over a stale non-note block.
check('NONE above real notes passes',
    pr('```release-note\nNONE\n```\n\n```release-note\nReal note\n```'), PASSED);
check('no block fails', pr('Just a description'), MISSING);
check('null body fails', pr(null), MISSING);
check('unclosed fence fails', pr('```release-note\nnotes but no closing fence'), MISSING);

// HTML comments must not satisfy the check: a PR template's commented-out
// block used to be read as if the author had written it.
check('commented-out template alone fails', pr('<!--\n```release-note\nNONE\n```\n-->'), MISSING);
check('commented TBD plus real notes passes',
    pr('<!-- ```release-note\nTBD\n``` -->\n```release-note\nReal note\n```'), PASSED);

// Every block is considered, not just the first.
check('stale TBD above real notes passes',
    pr('```release-note\nTBD\n```\n\n```release-note\nReal note\n```'), PASSED);
check('real notes above stale TBD passes',
    pr('```release-note\nReal note\n```\n\n```release-note\nTBD\n```'), PASSED);

// Draft PRs report but do not fail.
check('draft PR logs instead of failing',
    pr('```release-note\nTBD\n```', { draft: true }), { code: 0, contains: '[draft]' });

// Linear-time parsing. The previous regex backtracked cubically here: an
// unclosed fence followed by 65536 whitespace characters (GitHub's maximum
// body length) took an extrapolated 7.5 hours, hanging the job.
check('unclosed fence with 65536 whitespace chars',
    pr('```release-note' + '\n'.repeat(65536)), MISSING, { maxMs: 2000 });
check('unterminated HTML comment with 65536 whitespace chars',
    pr('<!--' + ' '.repeat(65536)), MISSING, { maxMs: 2000 });
check('many unterminated comment openers',
    pr('<!--'.repeat(16384)), MISSING, { maxMs: 2000 });
check('large body with valid notes',
    pr('x'.repeat(60000) + '\n```release-note\nok\n```'), PASSED, { maxMs: 2000 });

// Event guards.
check('non-pull_request event reports clearly',
    { push: {} }, { code: 1, contains: 'requires a pull_request event' });

// Annotation titles. These head the message in the Checks tab, and ':' and ','
// inside a property value have to arrive percent-encoded or the runner reads
// the command as truncated.
check('missing notes annotation carries a title',
    pr('Just a description'),
    { code: 1, contains: '::error title=No release notes::' });
check('placeholder annotation carries a title',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: '::error title=Release notes are still a placeholder::' });
check('negation annotation carries a title',
    pr('```release-note\nNONE\n```'),
    { code: 1, contains: '::error title=Release notes say no note is needed::' });
check('empty-block annotation carries a title',
    pr('```release-note\n\n```'),
    { code: 1, contains: '::error title=Release notes are empty::' });
check('event-guard annotation carries a title',
    { push: {} },
    { code: 1, contains: '::error title=Release notes check could not run::' });

// Job summary. The runner renders $GITHUB_STEP_SUMMARY on the run page, which
// is where "Details" on the PR leads.
check('failure writes a summary with the reason and an example',
    pr('```release-note\nTBD\n```'),
    {
        code: 1,
        contains: 'still a placeholder',
        summaryContains: '## Release notes: failed',
    });
check('failure summary shows a copyable example',
    pr('Just a description'),
    { code: 1, contains: 'No release notes found', summaryContains: '````\n```release-note' });
check('pass writes a summary',
    pr('```release-note\nReal note\n```'),
    { code: 0, contains: 'No errors detected', summaryContains: '## Release notes: passed' });
check('skipped label summary names the label',
    { pull_request: { labels: [{ name: 'other' }], body: '' } },
    {
        code: 0,
        contains: 'not present, skipping',
        summaryContains: 'The `release-note-required` label is not present',
    });
check('draft summary says the check is not enforced',
    pr('```release-note\nTBD\n```', { draft: true }),
    { code: 0, contains: '[draft]', summaryContains: '## Release notes: not enforced (draft)' });
check('event-guard writes a summary',
    { push: {} },
    {
        code: 1,
        contains: 'requires a pull_request event',
        summaryContains: '## Release notes: could not run',
    });

// Commit status. The stub API has to be its own process: execFileSync blocks
// this one's event loop, so a server listening here would never answer the
// child.
const STUB = path.join(tmp, 'stub-api.js');
fs.writeFileSync(STUB, [
    "const fs = require('fs');",
    "const http = require('http');",
    'const [status, requestLog, portFile] = process.argv.slice(2);',
    'const server = http.createServer((req, res) => {',
    "    let body = '';",
    "    req.on('data', chunk => { body += chunk; });",
    "    req.on('end', () => {",
    '        fs.appendFileSync(requestLog, JSON.stringify({',
    '            method: req.method,',
    '            url: req.url,',
    '            authorization: req.headers.authorization,',
    '            body,',
    "        }) + '\\n');",
    "        res.writeHead(Number(status), { 'content-type': 'application/json' });",
    "        res.end('{}');",
    '    });',
    '});',
    "server.listen(0, '127.0.0.1', () => {",
    '    fs.writeFileSync(portFile, String(server.address().port));',
    '});',
].join('\n'));

// Sleeping without the event loop, which execFileSync has already blocked.
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startStub(status) {
    const portFile = path.join(tmp, 'port-' + status);
    const requestLog = path.join(tmp, 'requests-' + status + '.jsonl');
    fs.rmSync(portFile, { force: true });
    fs.writeFileSync(requestLog, '');

    const child = spawn('node', [STUB, String(status), requestLog, portFile], { stdio: 'ignore' });

    for (let waited = 0; waited < 10000; waited += 50) {
        if (fs.existsSync(portFile)) {
            return {
                url: 'http://127.0.0.1:' + fs.readFileSync(portFile, 'utf8').trim(),
                requests: () => fs.readFileSync(requestLog, 'utf8').trim().split('\n')
                    .filter(Boolean).map(line => JSON.parse(line)),
                stop: () => child.kill(),
            };
        }
        sleepMs(50);
    }
    child.kill();
    throw new Error('stub API did not start');
}

const REPO_ENV = {
    GITHUB_REPOSITORY: 'tigera/check-release-notes',
    GITHUB_SERVER_URL: 'https://github.example',
    GITHUB_RUN_ID: '42',
};

// Without a token there is no status to report on, so the step itself has to
// fail: that is the only signal left that can block the pull request.
check('no token falls back to failing the job',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'Skipped the "Release notes" commit status: no github-token' });
check('no token fallback still annotates as an error',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: '::error title=Release notes are still a placeholder::' });
check('no token still passes a good PR',
    pr('```release-note\nReal note\n```'),
    { code: 0, contains: 'no github-token' });

const accepting = startStub(201);
check('failure reports on the status and lets the job succeed',
    pr('```release-note\nNONE\n```'),
    { code: 0, contains: 'Reported "Release notes say no note is needed"' },
    { env: { ...REPO_ENV, GITHUB_API_URL: accepting.url, GITHUB_TOKEN: 'stub-token' } });

const posted = accepting.requests();
const body = posted.length ? JSON.parse(posted[posted.length - 1].body) : {};
function expect(name, actual, wanted) {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted);
    if (!ok) {
        failures++;
    }
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name +
        (ok ? '' : '\n      expected ' + JSON.stringify(wanted) + ', got ' + JSON.stringify(actual)));
}
// The status has to be POSTed against the head SHA itself. A check run took a
// head_sha in its body and GitHub filed it under whichever check suite it liked,
// which is the bug this endpoint avoids.
expect('status is POSTed to the head SHA on the statuses endpoint',
    posted.length && posted[posted.length - 1].method + ' ' + posted[posted.length - 1].url,
    'POST /repos/tigera/check-release-notes/statuses/' + HEAD_SHA);
expect('status authenticates with the supplied token',
    posted.length && posted[posted.length - 1].authorization, 'Bearer stub-token');
expect('status names the context the PR can be blocked on', body.context, 'Release notes');
expect('status reports a failure', body.state, 'failure');
expect('status description carries the reason to the PR page',
    body.description, 'Release notes say no note is needed');
expect('status links to the run page, where the job summary is',
    body.target_url, 'https://github.example/tigera/check-release-notes/actions/runs/42');

// A green job alongside a red status needs the log to explain itself, and it
// must not carry an error annotation: that is what makes the job green at all.
check('a reported failure annotates as a notice, never an error',
    pr('```release-note\nNONE\n```'),
    {
        code: 0,
        contains: '::notice title=Release notes say no note is needed::',
        excludes: '::error',
    },
    { env: { ...REPO_ENV, GITHUB_API_URL: accepting.url, GITHUB_TOKEN: 'stub-token' } });
check('a reported failure names the check to make required',
    pr('Just a description'),
    { code: 0, contains: 'Make "Release notes" a required status check' },
    { env: { ...REPO_ENV, GITHUB_API_URL: accepting.url, GITHUB_TOKEN: 'stub-token' } });
expect('a reported failure still sets the status to failure',
    JSON.parse(accepting.requests().pop().body).state, 'failure');

check('a passing PR reports a success',
    pr('```release-note\nReal note\n```'),
    { code: 0, contains: 'Reported "Release note found"' },
    { env: { ...REPO_ENV, GITHUB_API_URL: accepting.url, GITHUB_TOKEN: 'stub-token' } });
expect('passing status is a success', JSON.parse(accepting.requests().pop().body).state, 'success');

// A commit status has no neutral state, so a draft passes and says why in the
// description rather than blocking a pull request that is still being written.
check('a draft passes rather than failing',
    pr('```release-note\nTBD\n```', { draft: true }),
    { code: 0, contains: 'Reported "Not enforced while this pull request is a draft"' },
    { env: { ...REPO_ENV, GITHUB_API_URL: accepting.url, GITHUB_TOKEN: 'stub-token' } });
const draftBody = JSON.parse(accepting.requests().pop().body);
expect('draft status is a success', draftBody.state, 'success');
expect('draft description says the check is not enforced',
    draftBody.description, 'Not enforced while this pull request is a draft');

accepting.stop();

// A run outside Actions has no run ID, so there is no run page to link to. The
// key is omitted rather than sent as a broken URL.
const noRunId = startStub(201);
check('a missing run ID still reports the status',
    pr('```release-note\nReal note\n```'),
    { code: 0, contains: 'Reported "Release note found"' },
    {
        env: {
            GITHUB_REPOSITORY: 'tigera/check-release-notes',
            GITHUB_API_URL: noRunId.url,
            GITHUB_TOKEN: 'stub-token',
        },
    });
expect('a missing run ID omits target_url',
    Object.prototype.hasOwnProperty.call(JSON.parse(noRunId.requests().pop().body), 'target_url'),
    false);
noRunId.stop();

// A read-only token, which is what a pull_request event from a fork gets.
const forbidding = startStub(403);
check('a read-only token falls back to failing the job',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'GitHub answered HTTP 403' },
    { env: { ...REPO_ENV, GITHUB_API_URL: forbidding.url, GITHUB_TOKEN: 'read-only-token' } });
check('the fallback annotates as an error and says why it fired',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'Failing this job instead' },
    { env: { ...REPO_ENV, GITHUB_API_URL: forbidding.url, GITHUB_TOKEN: 'read-only-token' } });
check('a read-only token does not turn a passing PR into a failure',
    pr('```release-note\nReal note\n```'),
    { code: 0, contains: 'The token is read-only' },
    { env: { ...REPO_ENV, GITHUB_API_URL: forbidding.url, GITHUB_TOKEN: 'read-only-token' } });
forbidding.stop();

const missing = startStub(404);
check('a token without statuses: write degrades to a log line',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'missing statuses: write' },
    { env: { ...REPO_ENV, GITHUB_API_URL: missing.url, GITHUB_TOKEN: 'weak-token' } });
missing.stop();

// Nothing is listening on port 1, so this exercises the network-failure path.
check('an unreachable API degrades to a log line',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'the request to GitHub failed' },
    { env: { ...REPO_ENV, GITHUB_API_URL: 'http://127.0.0.1:1', GITHUB_TOKEN: 'stub-token' } });

check('a payload with no head SHA skips the status',
    { pull_request: { labels: [{ name: 'release-note-required' }], body: '', draft: false } },
    { code: 1, contains: 'the event payload has no head SHA' },
    { env: { ...REPO_ENV, GITHUB_TOKEN: 'stub-token' } });
check('a missing GITHUB_REPOSITORY skips the status',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: 'GITHUB_REPOSITORY is not set' },
    { env: { GITHUB_TOKEN: 'stub-token' } });

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll tests passed.' : '\n' + failures + ' test(s) failed.');
process.exit(failures === 0 ? 0 : 1);
