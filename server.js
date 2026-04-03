const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/tests', express.static(path.join(__dirname, 'tests')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

app.get('/tests', (req, res) => {
  res.sendFile(path.join(__dirname, 'tests', 'n3ware.test.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`n3ware server running at http://localhost:${PORT}`);
  console.log(`  Landing: http://localhost:${PORT}/`);
  console.log(`  Demo:    http://localhost:${PORT}/demo`);
  console.log(`  Tests:   http://localhost:${PORT}/tests`);
});
