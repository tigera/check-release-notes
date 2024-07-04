const core = require('@actions/core');
const github = require('@actions/github');

try {
    const labelName = core.getInput('label-name');
    const context = github.context;
    const prNumber = context.pull_request.number;
    const prBaseName = context.base.repo.full_name;
    const prBody = context.pull_request.body;

    const prBaseNameSplit = prBaseName.split("/");

    const { data: pullRequest } = octokit.rest.pulls.get({
        owner: prBaseNameSplit[0],
        repo: prBaseNameSplit[1],
        pull_number: prNumber,
    });

    console.log(pullRequest);

    console.log(labelName)
    console.log(context)
    console.log(prNumber)
    console.log(prBaseName)
    console.log(prBody)


    // const payload = JSON.stringify(github.context.payload, undefined, 2)
    // console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}