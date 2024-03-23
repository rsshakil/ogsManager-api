/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const commonFunctions = require('./commonFunctions/getWhereFromFilter');
const commonFunctions1 = require('./commonFunctions/convertToMySQLSort');
const ssm = new AWS.SSM();

const PAGES_VISITED = 0;
const ITEMS_PER_PAGE = 500;

const mapperKey = {
    itemName: "itemTranslateName",
    categoryName: "itemCategoryId",
    tagName: "itemTagTagId",
}

/**
 * ManagerAppRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'PS_' + process.env.ENV,
            WithDecryption: true
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
    }


    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let parameter = [];
    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(readDbConfig);

        const { queryStringParameters = null, pathParameters = null } = event || {};

        //get list
        if (pathParameters === null) {
            const { skip: offset = PAGES_VISITED, take: limit = ITEMS_PER_PAGE, filter, sort } = queryStringParameters || {};

            let where = '';
            if (filter) {
                const { condition = '', conditionParameters = [] } = commonFunctions.getWhereFromFilter(filter, mapperKey);

                where = condition;
                parameter = [...parameter, ...conditionParameters];
            }

            console.log('my where is ', where);
            console.log('my where parameter is ', parameter);

            let orderBy = commonFunctions1.convertToMySQLSort(sort, 'itemCreatedAt DESC');

            const sql_count = `
                SELECT 
                    COUNT(DISTINCT Item.itemId) AS total_rows
                FROM Item
                JOIN CategoryTranslate ON Item.itemCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = ?
                JOIN ItemStock ON Item.itemId = ItemStock.itemStockItemId
                JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = ?
                LEFT JOIN ItemTag ON itemId = itemTagItemId
                ${where}`;

            console.log('count sql ', sql_count)

            const [query_result_count, query_fields_count] = await mysql_con.query(sql_count, [1, 1, ...parameter]);

            const item_tags_subquery = `
                SELECT 
                    GROUP_CONCAT(tagName) AS tagName
                FROM ItemTag
                JOIN Tag ON ItemTag.itemTagTagId = Tag.tagId
                WHERE ItemTag.itemTagItemId = Item.itemId`;

            const sql_data = `
                SELECT DISTINCT 
                    itemId, 
                    BIN_TO_UUID(Item.itemUUID) AS itemUUID, 
                    itemTranslateName AS itemName,
                    itemAttribute2,
                    itemAttribute3,
                    itemAttribute4,
                    itemShippingFlag, 
                    itemCreatedAt*1000 AS itemCreatedAt, 
                    itemUpdatedAt*1000 AS itemUpdatedAt, 
                    itemStatus, 
                    categoryTranslateName AS categoryName, 
                    LEAST(itemStockUnsetCount, 999999) AS itemStockUnsetCount, 
                    itemStockGachaCount, 
                    itemStockCollectionCount, 
                    itemStockShippingRequestCount, 
                    itemStockShippedCount, 
                    itemStockOtherCount, 
                    (${item_tags_subquery}) AS tagName
                FROM Item
                JOIN CategoryTranslate ON Item.itemCategoryId = CategoryTranslate.categoryTranslateCategoryId AND categoryTranslateJpFlag = ?
                JOIN ItemStock ON Item.itemId = ItemStock.itemStockItemId
                JOIN ItemTranslate ON Item.itemId = ItemTranslate.itemTranslateItemId AND itemTranslateJpFlag = ?
                LEFT JOIN ItemTag ON itemId = itemTagItemId
                ${where}
                ${orderBy}
                LIMIT ?, ?`;

            parameter.push(Number(offset));
            parameter.push(Number(limit));

            console.log('final  sql_data ', sql_data)

            const [query_result_data, query_fields_data] = await mysql_con.query(sql_data, [1, 1, ...parameter]);

            response = {
                count: query_result_count[0]?.total_rows,
                records: query_result_data,
            }
        }
        //get detail
        else if (pathParameters !== null) {
            const { itemId = 0 } = pathParameters || {};

            //For initial data
            if (itemId == 'init') {
                const category_query = `
                    SELECT 
                        categoryTranslateCategoryId AS categoryId, 
                        categoryTranslateName AS categoryName 
                    FROM CategoryTranslate 
                    JOIN Translate ON categoryTranslateTranslateId = Translate.translateId
                    WHERE categoryTranslateJpFlag = ?
                    ORDER BY categoryId ASC
                `;

                const tags_query = `
                    SELECT  
                        tagId, 
                        tagName
                    FROM Tag 
                    ORDER BY tagOrder ASC
                `;

                const translate_query = `
                    SELECT 
                        translateId,
                        Language.languageName AS translateName,
                        translateJpFlag
                    FROM Translate
                    INNER JOIN Language ON Translate.translateLanguageId = Language.languageId
                    ORDER BY translateId ASC
                `;

                const [query_result_category, query_fields_category] = await mysql_con.query(category_query, [1]);
                const [query_result_tag, query_fields_tag] = await mysql_con.query(tags_query, []);
                const [query_result_translate, query_fields_translate] = await mysql_con.query(translate_query, [1]);

                response = {
                    categories: query_result_category,
                    tags: query_result_tag,
                    translates: query_result_translate,
                }
            }
            //For item details
            else {
                //Subquery to get itemTags id in array
                const item_tags_subquery = `
                    SELECT 
                        JSON_ARRAYAGG(itemTagTagId)
                    FROM ItemTag
                    WHERE ItemTag.itemTagItemId = Item.itemId
                `;

                const item_translate_subquery = `
                    SELECT 
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'translateId', Translate.translateId,
                                'translateName', Language.languageName,
                                'itemTranslateTranslateId', Translate.translateId,
                                'itemTranslateJpFlag', Translate.translateJpFlag,
                                'itemTranslateName', ItemTranslate.itemTranslateName,
                                'itemTranslateDescription1', ItemTranslate.itemTranslateDescription1,
                                'itemTranslateDescription2', ItemTranslate.itemTranslateDescription2,
                                'itemTranslateDescription3', ItemTranslate.itemTranslateDescription3
                            )
                        )
                    FROM Translate
                    LEFT OUTER JOIN ItemTranslate ON ItemTranslate.itemTranslateTranslateId = Translate.translateId AND ItemTranslate.itemTranslateItemId = Item.itemId
                    INNER JOIN Language ON Translate.translateLanguageId = Language.languageId
                    WHERE 1
                    ORDER BY translateJpFlag DESC, translateId ASC
                `;

                const sql_data = `
                    SELECT 
                        itemId, 
                        BIN_TO_UUID(Item.itemUUID) AS itemUUID, 
                        itemImagePath1,
                        itemImagePath2,
                        itemImagePath3,
                        itemStatus, 
                        itemShippingFlag, 
                        itemCategoryId,
                        itemMemo,
                        itemAttribute1,
                        itemAttribute2,
                        itemAttribute3,
                        itemAttribute4,
                        itemAttribute5,
                        itemAttribute6,
                        itemAttribute7,
                        itemAttribute8,
                        (${item_tags_subquery}) AS itemTags,
                        (${item_translate_subquery}) AS itemTranslates,
                        LEAST(itemStockUnsetCount, 999999) AS itemStockUnsetCount,
                        itemStockGachaCount,
                        itemStockCollectionCount,
                        itemStockShippingRequestCount,
                        itemStockShippedCount,
                        itemStockOtherCount, 
                        itemStockMemo
                    FROM Item
                    JOIN ItemStock ON Item.itemId = ItemStock.itemStockItemId
                    WHERE itemId = ?
                    LIMIT 0, 1
                `;

                parameter.push(Number(itemId));

                const [query_result_data, query_fields_data] = await mysql_con.query(sql_data, parameter);

                if (query_result_data.length > 0)
                    response = { records: query_result_data[0] }
                else
                    response = { message: 'no data', }
            }
        }

        console.log('my response', response)

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }
};