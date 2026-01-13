// Extracted PR comment logic for clarity and reusability
// Reads test output and score from files, optionally minimizes previous bot comments

const fs = require('fs');
const path = require('path');

const getTestResults = () => {
  const scorePath = path.join(process.cwd(), '.hyf', 'score.json');
  const outputPath = path.join(process.cwd(), '.hyf', 'test-output.txt');

  const scoreRaw = fs.readFileSync(scorePath, 'utf8');
  const scoreJson = JSON.parse(scoreRaw);

  const score = String(scoreJson.score ?? '0');
  const passingScore = String(scoreJson.passingScore ?? '100');
  const pass = Boolean(scoreJson.pass);
  const output = fs.readFileSync(outputPath, 'utf8');
  return { score, passingScore, pass, output };
}

module.exports = async function run({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issue_number = context.issue.number;

  let testResults = null;
  try {
    testResults = getTestResults();
  } catch (err) {
    core?.error(`Failed to read/parse score.json or test-output.txt: ${err.message}`);
    return;
  }

  const { score, passingScore, pass, output } = testResults;
  const icon = pass ? '✅' : '❌';
  const status = pass ? `${icon} Passed` : `${icon} Not passed`;

  // Clean, well-formatted markdown body (no stray indentation or spacing)
  const body = `## 📝 HackYourFuture auto grade
  ### Assignment Score: ${score} / 100 ${icon}
**Status:** ${status}
**Minimum score to pass:** ${passingScore}
*🧪 The auto grade is experimental and still being improved*
<details>
<summary>Test Details</summary>

\`\`\`
${output.trimEnd()}
\`\`\`

</details>`;

  // Minimize previous bot comments before posting a new one
  await hidePreviousComments(github, owner, repo, issue_number);

  // Post the new comment
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number,
    body
  });
};


const hidePreviousComments = async (github, owner, repo, issue_number) => {
  // Minimize (hide) previous bot comments with our header using GraphQL API
  const headerMatcher = /##\s*Assignment\s*score/i;
  const { data: allComments } = await github.rest.issues.listComments({ owner, repo, issue_number, per_page: 100 });

  const assignmentComments = allComments.filter(c => {
    const isBot = c.user?.type === 'Bot' || /\[bot\]$/i.test(c.user?.login || '');
    const isOurComment = c.body && headerMatcher.test(c.body);
    return isBot && isOurComment;
  });

  for (const c of assignmentComments) {
    try {
      await github.graphql(
        `mutation($id: ID!) {
          minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) {
            minimizedComment { isMinimized }
          }
        }`,
        { id: c.node_id }
      );
    } catch (err) {
      // Best-effort minimization; continue if already minimized or not permitted
      core?.warning(`Could not minimize comment ${c.id}: ${err.message}`);
    }
  }
}