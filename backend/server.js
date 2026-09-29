const express = require('express');
const { simpleGit } = require('simple-git');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');
const { analyzeRepo, listAllFiles } = require('./parser');
const { buildDependencyGraph } = require('./dependencies');

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
/*  here path  joins all those things with\
the cloned repo is on servers disk 
tmpdir ask for the where is temp folder and date and all */
  
  try {
    await simpleGit().clone(githubUrl, tempPath);
    const files = fs.readdirSync(tempPath);
    const facts = analyzeRepo(tempPath);
    const allFiles = listAllFiles(tempPath);
    const dependencies = buildDependencyGraph(facts, tempPath);
    res.json({ status: 'success', files, facts, allFiles, dependencies });
  } catch (error) {
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