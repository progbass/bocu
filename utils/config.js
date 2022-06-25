require('dotenv').config();

module.exports = {
	apiKey: process.env.API_KEY,
	authDomain: process.env.AUTH_DOMAIN,
	projectId: process.env.PROJECT_ID,
	storageBucket: process.env.STORAGE_BUCKET,
	messagingSenderId: process.env.MESSAGING_SENDER_ID,
	appId: process.env.APP_ID,
	measurementId: process.env.MEASUREMENT_ID,
	databaseURL: process.env.DATABASE_URL,
	algoliaAppId: process.env.ALGOLIA_APP_ID,
	algoliaAdminApiKey: process.env.ALOGLIA_ADMIN_API_KEY
  };
