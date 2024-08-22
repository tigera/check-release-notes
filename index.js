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

    failureMessage = ""

    if (labels_names.includes(labelName)) {
        match = re.exec(prBody);
        if (match == null) {
            failureMessage = "No release notes found in PR body"
        } else {
            releaseNotes = match[0].trim();
            if (releaseNotes.toUpperCase() == "TBD") {
                failureMessage = "Release notes are still TBD"
            }
            if (releaseNotes == "") {
                failureMessage = "Release notes are empty"
            }
        }
    } else {
        console.log("Label " + labelName + " not present, skipping validation")
    }

    if (failureMessage != "") {
        if (context.payload.pull_request.draft == true) {
            console.log("[draft] PR contained the following issue: " + failureMessage)
        } else {
            core.setFailed("An error was found: " + failureMessage)
        }
    } else {
        console.log("No errors detected in release notes.")
    }

} catch (error) {
    core.setFailed(error.message);
}