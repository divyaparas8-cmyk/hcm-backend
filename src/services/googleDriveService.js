// ============================================================
// Google Drive Integration Service (OAuth 2.0 per Organization)
// ============================================================

const fs = require('fs');
const axios = require('axios');
const prisma = require('../config/prisma');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'mock-client-id.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'mock-client-secret';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/admin/google-drive/callback';

/**
 * Generate Google OAuth 2.0 consent URL for an organization
 */
const getAuthUrl = (organizationId) => {
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ');

  const state = Buffer.from(JSON.stringify({ organizationId, t: Date.now() })).toString('base64');

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

/**
 * Exchange OAuth Code for Tokens
 */
const exchangeCodeForTokens = async (code, organizationId) => {
  try {
    // Exchange code with Google
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Fetch user email / profile from Google
    let accountEmail = null;
    let accountName = null;
    try {
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      accountEmail = userRes.data?.email || null;
      accountName = userRes.data?.name || null;
    } catch {}

    const expiryDate = BigInt(Date.now() + (expires_in || 3600) * 1000);

    const integration = await prisma.googleDriveIntegration.upsert({
      where: { organizationId },
      create: {
        organizationId,
        accessToken: access_token,
        refreshToken: refresh_token || null,
        expiryDate,
        accountEmail,
        accountName,
        isConnected: true,
        connectedAt: new Date()
      },
      update: {
        accessToken: access_token,
        ...(refresh_token ? { refreshToken: refresh_token } : {}),
        expiryDate,
        accountEmail: accountEmail || undefined,
        accountName: accountName || undefined,
        isConnected: true,
        connectedAt: new Date()
      }
    });

    return { success: true, integration };
  } catch (err) {
    console.error('[GoogleDriveService] Token exchange error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.error_description || err.message || 'Failed to exchange Google OAuth code.');
  }
};

/**
 * Get Valid Access Token (Refreshes if expired)
 */
const getValidAccessToken = async (organizationId) => {
  const integration = await prisma.googleDriveIntegration.findUnique({
    where: { organizationId }
  });

  if (!integration || !integration.isConnected || !integration.accessToken) {
    throw new Error('Google Drive is not connected for this organization.');
  }

  const now = Date.now();
  const isExpired = integration.expiryDate ? Number(integration.expiryDate) < (now + 60000) : false;

  if (!isExpired) {
    return integration.accessToken;
  }

  // Attempt token refresh
  if (!integration.refreshToken) {
    throw new Error('Google Drive session expired. Please reconnect your Google Drive account.');
  }

  try {
    const refreshRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: integration.refreshToken,
      grant_type: 'refresh_token'
    });

    const { access_token, expires_in } = refreshRes.data;
    const newExpiry = BigInt(now + (expires_in || 3600) * 1000);

    await prisma.googleDriveIntegration.update({
      where: { organizationId },
      data: {
        accessToken: access_token,
        expiryDate: newExpiry
      }
    });

    return access_token;
  } catch (err) {
    console.error('[GoogleDriveService] Refresh token error:', err.response?.data || err.message);
    throw new Error('Google Drive authorization expired. Please reconnect.');
  }
};

/**
 * Helper to Find or Create a Directory in Google Drive
 */
const findOrCreateFolder = async (accessToken, folderName, parentFolderId = null) => {
  let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentFolderId) {
    query += ` and '${parentFolderId}' in parents`;
  }

  try {
    const searchRes = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: query, fields: 'files(id, name)' }
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      return searchRes.data.files[0].id;
    }

    // Create new folder
    const createRes = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentFolderId ? { parents: [parentFolderId] } : {})
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return createRes.data.id;
  } catch (err) {
    console.error('[GoogleDriveService] Folder create error:', err.response?.data || err.message);
    return null;
  }
};

/**
 * Upload Backup Archive to Google Drive
 */
const uploadBackupToDrive = async (organizationId, filePath, fileName) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('Backup file not found on server.');
  }

  const accessToken = await getValidAccessToken(organizationId);
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  const orgName = org?.name || 'Organization';

  // Structure: HCM Backups / {Organization Name}
  const rootFolderId = await findOrCreateFolder(accessToken, 'HCM Backups');
  const orgFolderId = rootFolderId ? await findOrCreateFolder(accessToken, orgName, rootFolderId) : null;

  const fileMetadata = {
    name: fileName,
    parents: orgFolderId ? [orgFolderId] : (rootFolderId ? [rootFolderId] : [])
  };

  const fileContent = fs.readFileSync(filePath);
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody = Buffer.concat([
    Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(fileMetadata) +
      delimiter +
      'Content-Type: application/zip\r\n\r\n'
    ),
    fileContent,
    Buffer.from(closeDelimiter)
  ]);

  try {
    const uploadRes = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
      multipartRequestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': multipartRequestBody.length
        }
      }
    );

    return {
      success: true,
      fileId: uploadRes.data.id,
      fileName: uploadRes.data.name,
      driveLink: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`
    };
  } catch (err) {
    console.error('[GoogleDriveService] Upload error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.error?.message || err.message || 'Failed to upload backup to Google Drive.');
  }
};

/**
 * Disconnect Google Drive
 */
const disconnect = async (organizationId) => {
  await prisma.googleDriveIntegration.updateMany({
    where: { organizationId },
    data: {
      accessToken: null,
      refreshToken: null,
      isConnected: false
    }
  });
  return { success: true };
};

/**
 * Get Integration Status
 */
const getStatus = async (organizationId) => {
  const integration = await prisma.googleDriveIntegration.findUnique({
    where: { organizationId }
  });

  return {
    isConnected: !!integration?.isConnected,
    accountEmail: integration?.accountEmail || null,
    accountName: integration?.accountName || null,
    connectedAt: integration?.connectedAt || null
  };
};

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getValidAccessToken,
  uploadBackupToDrive,
  disconnect,
  getStatus
};
