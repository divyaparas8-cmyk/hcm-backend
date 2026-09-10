const axios = require('axios');

async function test() {
  try {
    const loginRes = await axios.post('http://localhost:5001/api/auth/login', {
      email: 'john.doe@hcm.ai', // Using standard seed email
      password: 'password123'
    });
    const token = loginRes.data.token;
    
    console.log('Got token:', token ? 'YES' : 'NO');
    
    const profileRes = await axios.get('http://localhost:5001/api/employee/profile', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('GET /profile success:', profileRes.data.data ? 'YES' : 'NO');
    
    const putRes = await axios.put('http://localhost:5001/api/employee/profile', {
      bio: 'Updated bio testing'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('PUT /profile success:', putRes.data.data ? 'YES' : 'NO');
    
  } catch (err) {
    console.error('Test failed:', err.response ? err.response.data : err.message);
  }
}

test();
