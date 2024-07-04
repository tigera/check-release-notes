const core = require('@actions/core');
const github = require('@actions/github');

try {
    const labelName = core.getInput('label-name');
    const context = github.context;

    console.log(context)

    const prNumber = context.payload.number;
    const labels = context.payload.pull_request.labels;
    const prBody = context.payload.pull_request.body;

    console.log(labelName)
    console.log(prNumber)
    console.log(labels)
    console.log(prBody)


    // const payload = JSON.stringify(github.context.payload, undefined, 2)
    // console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}