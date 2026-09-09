const axios = require('axios');

async function testSettings() {
  try {
    const loginRes = await axios.post('http://localhost:5001/api/auth/login', {
      email: 'candidate@hcm.ai',
      password: 'password123'
    });
    const token = loginRes.data.token;
    
    console.log('Got token:', token ? 'YES' : 'NO');
    
    const putRes = await axios.put('http://localhost:5001/api/employee/settings', {
      displayName: 'Jane Settings Tester',
      language: 'English (US)',
      timezone: 'UTC-08:00 (Pacific Time)',
      dateFormat: 'MM/DD/YYYY',
      emailNotif: false,
      pushNotif: false
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('PUT /settings success:', putRes.data.success);
    console.log('Updated Data:', putRes.data.data);
    
    // revert
    await axios.put('http://localhost:5001/api/employee/settings', {
      displayName: 'Jane Smith',
      emailNotif: true,
      pushNotif: true
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
  } catch (err) {
    console.error('Test failed:', err.response ? err.response.data : err.message);
  }
}

testSettings();
