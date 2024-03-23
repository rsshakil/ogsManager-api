/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    const data = JSON.parse(event.body) || [];

    let mysql_con;
    let response;

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        //Identify create/update/remove records
        const createRecords = data.changes.filter(x => x.type == 'insert' && Object.keys(x.data).length > 1);
        const updateRecords = data.changes.filter(x => x.type == 'update');
        const removeRecords = data.changes.filter(x => x.type == 'remove');

        const insert_category_translate_query = `INSERT INTO CategoryTranslate (categoryTranslateCategoryId, categoryTranslateTranslateId, categoryTranslateName, categoryTranslateJpFlag) VALUES ?`;

        //Insert
        if (createRecords.length > 0) {
            const insert_category_query = `INSERT INTO Category (categoryId) VALUES (?)`;
            const categoryNullValue = [null];

            for (const category of createRecords) {
                const insert_category_sql_param = createRecords.map(x => categoryNullValue);
                const [query_result, query_fields_category] = await mysql_con.query(insert_category_query, insert_category_sql_param);

                const { data } = category || {};
                const translateNames = getTranslateNames(data);

                const insert_category_translate_sql_params = translateNames.map((name, i) => [query_result.insertId, name.localizeId, name.translateName, name.translateJpFlag]);
                await mysql_con.query(insert_category_translate_query, [insert_category_translate_sql_params]);
            }
        }

        //Update
        if (updateRecords.length > 0) {
            const update_category_translate_query = `
                UPDATE
                CategoryTranslate
                SET categoryTranslateName = ?, categoryTranslateJpFlag = ?
                WHERE categoryTranslateId = ?
            `;

            for (const category of updateRecords) {
                const { data, key } = category || {};
		        const translateNames = getTranslateNames(data, key);

                for (const name of translateNames) {
                    if (name.categoryTranslateId) {
                        const update_category_translate_sql_params = [name.translateName, name.translateJpFlag, name.categoryTranslateId];    
                        await mysql_con.query(update_category_translate_query, update_category_translate_sql_params);    
                    }
                    else {
                        const insert_category_translate_sql_params = translateNames.map((name, i) => [name.categoryId, name.localizeId, name.translateName, name.translateJpFlag]);
                        await mysql_con.query(insert_category_translate_query, [insert_category_translate_sql_params]);
                    }
                }
            }
        }

        //Delete
        if (removeRecords.length > 0) {
            const categoryIdsToDelete = removeRecords.map(x => x.key.categoryId);

            const category_remove_query = `DELETE FROM Category WHERE categoryId IN (?)`;
            await mysql_con.query(category_remove_query, [categoryIdsToDelete]);

            const category_translate_remove_query = `DELETE FROM CategoryTranslate WHERE categoryTranslateCategoryId IN (?)`;
            await mysql_con.query(category_translate_remove_query, [categoryIdsToDelete]);
        }

        //Memo
        const systemUpdateQuery = `UPDATE ServiceInfo SET serviceInfoCategoryMemo = ? ORDER BY serviceInfoId ASC LIMIT 1`;
        await mysql_con.execute(systemUpdateQuery, [data.categoryMemo]);

        await mysql_con.commit();

        response = {
            records: {}
        };

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
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

    function getTranslateNames(data, key={}) {
        let translateNames = [];

        for (let arrKey in data) {
            if (arrKey !== '__KEY__') {
                const localizeInfo = arrKey.replace("categoryTranslateName", "");
                // Here localizeInfoArr[0] --> localizeId & localizeInfoArr[1] --> translateJpFlag
                const localizeInfoArr = localizeInfo.split('_');
                const translateName = data[arrKey];
                // Here getting categoryTranslateId from data object
                const categoryTranslateId = key[`categoryTranslateId_${localizeInfoArr[0]}`] ?? null;
                const categoryId = key['categoryId'] ?? null;

                translateNames.push({
                    translateName,
                    localizeId: Number(localizeInfoArr[0]),
                    translateJpFlag: Number(localizeInfoArr[1]),
                    categoryTranslateId,
                    categoryId
                });
            }
        }
        return translateNames;
    }
};