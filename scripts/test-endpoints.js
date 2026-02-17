const http = require('http');

const urls = [
  'http://localhost:3001/api/public/assessments/active/structure',
  'http://localhost:3001/api/public/recommendations/definition',
  'http://localhost:3001/api/public/narrative/definition'
];

console.log('🚀 Testing API Endpoints...\n');

urls.forEach(url => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log(`✅ URL: ${url}`);
      console.log(`   Status: ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log(`   Body snippet: ${data.substring(0, 100).replace(/\n/g, ' ')}...`);
      } else {
        console.log(`   Error Body: ${data}`);
      }
      console.log('---');
    });
  }).on('error', (err) => {
    console.error(`❌ Error fetching ${url}:`, err.message);
  });
});
