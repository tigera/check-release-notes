const core = require('@actions/core');
const github = require('@actions/github');

const re = new RegExp("(?<=```release-note\s*)(.*?)(?=\s*```)", 's');

try {
    const labelName = core.getInput('label-name');
    const context = github.context;

    const prNumber = context.payload.number;
    const labels = context.payload.pull_request.labels;
    const prBody = context.payload.pull_request.body;

    const labels_names = labels.map(item => item.name)

    if (labels_names.includes(labelName)) {
        console.log("PR does contain the label " + labelName);
        match = re.exec(prBody);
        if (match == null) {
            core.setFailed("No release notes found in PR body")
        } else {
            releaseNotes = match[0].trim();
            if (releaseNotes.toUpperCase() == "TBD") {
                core.setFailed("Release notes are still TBD")
            }
            if (releaseNotes == "") {
                core.setFailed("Release notes are empty")
            }
        }
    } else {
        console.log("Label " + labelName + " not present, skipping validation")
    }

} catch (error) {
    core.setFailed(error.message);
}