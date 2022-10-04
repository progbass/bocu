const { db } = require("../utils/admin");
const { 
    addDoc,
    collection, 
    getDocs, 
    query, 
} = require('firebase/firestore'); 
const { slugifyString } = require("../utils/formatters");
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
        slug: slugifyString(request.body.name) || "",
    };

    // Insert Category
    const documentRef = await addDoc(
        collection(db, 'Categories'),
        newCategoryItem
    ).catch((err) => {
      console.error(err);
      return response.status(500).json({ ...err, message: 'Error al crear la categoría.' });
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
        ...err,
        message: 'Error al obtener las categorías.',
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
            message: "No se encontraron categorías.",
        });
    }
};