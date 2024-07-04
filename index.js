const core = require('@actions/core');
const github = require('@actions/github');

try {
    const labelName = core.getInput('label-name');
    const context = github.context;
    const prNumber = github.number;

    const fullNameSplit = github.full_name.split("/")

    const { data: pullRequest } = await octokit.rest.pulls.get({
        owner: fullNameSplit[0],
        repo: fullNameSplit[1],
        pull_number: prNumber,
    });

    console.log(fullNameSplit);
    console.log(prNumber)
    console.log("Got information about" + pullRequest);

    // const payload = JSON.stringify(github.context.payload, undefined, 2)
    // console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}