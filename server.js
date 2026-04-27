const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// Init Firebase
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  console.log('✅ Firebase connecté');
} catch(e) {
  console.error('❌ Firebase erreur:', e.message);
}

// ROUTE TEST
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// ROUTE 1 : Vérifier version
app.get('/api/version/:platform', async (req, res) => {
  try {
    const doc = await db.collection('versions').doc(req.params.platform).get();
    if (!doc.exists) return res.status(404).json({ error: 'Document non trouvé' });
    res.json(doc.data());
  } catch(e) {
    console.error('Firestore erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ROUTE 2 : Upload APK vers GitHub
app.post('/api/upload-apk', upload.single('apk'), async (req, res) => {
  try {
    const { version, release_notes, force_update } = req.body;
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
    const tag = `v${version}`;
    const headers = { Authorization: `token ${GITHUB_TOKEN}` };
    const release = await axios.post(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      { tag_name: tag, name: `ProximaShop ${tag}`, body: release_notes },
      { headers }
    );
    const filename = `proxima_${version}.apk`;
    const uploadUrl = release.data.upload_url.replace('{?name,label}', `?name=${filename}`);
    await axios.post(uploadUrl, req.file.buffer, {
      headers: { ...headers, 'Content-Type': 'application/vnd.android.package-archive' }
    });
    const apk_url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${filename}`;
    await db.collection('versions').doc('android').set({
      current_version: version, apk_url, release_notes,
      force_update: force_update === 'true',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('logs').add({
      action: 'apk_uploaded', version,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true, apk_url });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ROUTE 3 : Config
app.post('/api/config', async (req, res) => {
  try {
    await db.collection('config').doc('app_settings').update(req.body);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ROUTE 4 : Notification
app.post('/api/notify', async (req, res) => {
  try {
    const { title, body } = req.body;
    await admin.messaging().send({ topic: 'all_users', notification: { title, body } });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => 
  console.log(`✅ Proxima Server actif sur port ${process.env.PORT || 3000}`)
);