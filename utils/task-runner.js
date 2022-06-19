const functions = require('firebase-functions');
const { db, app } = require('../utils/admin');

module.exports = async (request, response, next) => {

        // Consistent timestamp
        const now = app.firestore.Timestamp.now();
        console.log('here!!!')
        return;
        
        // Query all documents ready to perform
        const query = db.collection('tasks').where('performAt', '<=', now).where('status', '==', 'scheduled');

        const tasks = await query.get();


        // Jobs to execute concurrently. 
        const jobs = [];

        // Loop over documents and push job.
        tasks.forEach(snapshot => {
            const { worker, options } = snapshot.data();

            const job = workers[worker](options)
                
                // Update doc with status on success or error
                .then(() => snapshot.ref.update({ status: 'complete' }))
                .catch((err) => snapshot.ref.update({ status: 'error' }));

            jobs.push(job);
        });

        // Execute all jobs concurrently
        return await Promise.all(jobs);

};