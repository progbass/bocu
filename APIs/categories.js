const { db, app, auth, storage } = require("../utils/admin");
const { 
    deleteDoc,
    addDoc,
    collection, 
    limit, 
    orderBy, 
    getDocs, 
    getDoc, 
    doc, 
    query, 
    where, 
    updateDoc 
} = require('firebase/firestore'); 
const slugify = require("slugify");
const dayjs = require("dayjs");
var utc = require("dayjs/plugin/utc");
var timezone = require("dayjs/plugin/timezone");

// Dates configuration.
dayjs.extend(utc);
dayjs.extend(timezone);

// Create Category
exports.createCategory = async (request, response) => {
    // Data Model
    let newCategoryItem = {
        active: true,
        createdAt: new Date(),
        description: request.body.description || "",
        thumbnail: request.body.thumbnail || "",
        thumbnail_on: request.body.thumbnail || "",
        name: request.body.name || "",
        slug: slugify(request.body.name.toLowerCase()) || "",
    };

    // Insert Category
    const documentRef = await addDoc(
        collection(db, 'Categories'),
        newCategoryItem
    ).catch((err) => {
      console.error(err);
      return response.status(500).json({ error: err.code });
    });

    //
    return response.json({
        id: documentRef.id,
        ...newCategoryItem,
    });
};

// Get Categories
exports.getCategories = async (request, response) => {
    // Get Deals collection
    const dealsCollection = await getDocs(query(
        collection(db, `Categories`)
    )).catch((err) => {
      return response.status(500).json({
        error: err.code,
      });
    });

    // Response
    if (dealsCollection.size > 0) {
        let categories = [];
        dealsCollection.forEach((doc) => {
            categories.push({
                ...doc.data(),
                id: doc.id,
            });
        });
        return response.json(categories);
    } else {
        return response.status(204).json({
            error: "No categories were found.",
        });
    }
};