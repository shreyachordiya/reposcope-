const express = require('express');
const {simpleGit} = require('simple-git');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('RepoScope backend is running');
});

app.post('/analyze', async (req, res) => {
  const { githubUrl } = req.body;

  const tempPath = path.join(os.tmpdir(), 'reposcope-' + Date.now());
/*  here path join joins all those things with\
the cloned repo is on servers disk 
tmpdir ask for the where is temp folder and date and all */
  try {
    await simpleGit().clone(githubUrl, tempPath);// clone the repo into the temp folder
    const files = fs.readdirSync(tempPath);// list the files and folders inside it
    res.json({ status: 'success', files: files });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.listen(5000, () => {
  console.log('Server running on http://localhost:5000');
});