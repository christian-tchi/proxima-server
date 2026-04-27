const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// Init Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ 
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});
const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// ROUTE 1 : Vérifier version (appelée par l'app)
app.get('/api/version/:platform', async (req, res) => {
  const doc = await db.collection('versions').doc(req.params.platform).get();
  res.json(doc.data());
});

// ROUTE 2 : Upload APK vers GitHub Releases
app.post('/api/upload-apk', upload.single('apk'), async (req, res) => {
  const { version, release_notes, force_update } = req.body;
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const tag = `v${version}`;
  const headers = { Authorization: `token ${GITHUB_TOKEN}` };

  // Créer la release GitHub
  const release = await axios.post(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
    { tag_name: tag, name: `ProximaShop ${tag}`, body: release_notes },
    { headers }
  );

  // Uploader le fichier APK
  const filename = `proxima_${version}.apk`;
  const uploadUrl = release.data.upload_url.replace('{?name,label}', `?name=${filename}`);
  await axios.post(uploadUrl, req.file.buffer, {
    headers: { ...headers, 'Content-Type': 'application/vnd.android.package-archive' }
  });

  // Mettre à jour Firestore
  const apk_url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${filename}`;
  await db.collection('versions').doc('android').set({
    current_version: version, apk_url,
    release_notes, force_update: force_update === 'true',
    created_at: admin.firestore.FieldValue.serverTimestamp()
  });
  // Log
  await db.collection('logs').add({ action: 'apk_uploaded', version, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  res.json({ success: true, apk_url });
});

// ROUTE 3 : Modifier config à distance
app.post('/api/config', async (req, res) => {
  await db.collection('config').doc('app_settings').update(req.body);
  res.json({ success: true });
});

// ROUTE 4 : Notification push
app.post('/api/notify', async (req, res) => {
  const { title, body } = req.body;
  await admin.messaging().send({ topic: 'all_users', notification: { title, body } });
  res.json({ success: true });
});

app.listen(process.env.PORT, () => console.log(`✅ Proxima Server actif sur port ${process.env.PORT}`));