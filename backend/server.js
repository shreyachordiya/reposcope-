const express = require('express');
const { simpleGit } = require('simple-git');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');
const { analyzeRepo, listAllFiles } = require('./parser');
const { buildDependencyGraph } = require('./dependencies');
const { buildArchitecture } = require('./architecture');
const { buildImpact } = require('./impact');
const { buildSecurity } = require('./security');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('RepoScope backend is running');
});

app.post('/analyze', async (req, res) => {
  const { githubUrl } = req.body;

  // temp folder on the server's disk where the repo gets cloned
  const tempPath = path.join(os.tmpdir(), 'reposcope-' + Date.now());

  try {
    await simpleGit().clone(githubUrl, tempPath,['--depth', '1']);
    const files = fs.readdirSync(tempPath);
    const facts = analyzeRepo(tempPath);
    const allFiles = listAllFiles(tempPath);
    const dependencies = buildDependencyGraph(facts, tempPath);
    const architecture = buildArchitecture(facts, dependencies);
    const impact = buildImpact(dependencies, facts);
    const security = buildSecurity(tempPath);   // use the same variable you pass to buildDependencyGraph as rootDir
    res.json({ status: 'success', files, facts, allFiles, dependencies, architecture, impact,security});
  } catch (error) {
    console.log('ANALYZE ERROR:', error);
    res.status(500).json({ status: 'error', message: error.message });
  } finally {
    // delete the cloned copy so temp folders don't pile up
    try {
      fs.rmSync(tempPath, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      console.log('could not delete temp folder:', tempPath);
    }
  }
});

app.listen(5000, () => {
  console.log('Server running on http://localhost:5000');
});