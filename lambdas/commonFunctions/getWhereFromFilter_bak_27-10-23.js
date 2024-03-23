const dateColumnList = [
    'itemUpdatedAt', 'itemCreatedAt',
    'gachaPostStartDate', 'gachaStartDate', 'gachaEndDate', 'gachaUpdatedAt', 'gachaBuiltedAt',
    'userCollectionRequestAt', 'userCollectionUpdatedAt', 'userCollectionShippedAt',
    // 'userPointLastPurchaseAt', 'userCreatedAt', 'userLastLoginAt', 'userUpdatedAt',
];

const binaryUuidColumnList = [
    'userCollectionTransactionUUID', 'itemUUID', 'userUUID'
];


exports.getWhereFromFilter = (filter, mapperKeys = {}) => {
    let queryObj = JSON.parse(filter);
    let conditionParameters = [];

    if (typeof queryObj !== 'object') {
        return {
            condition: '',
            conditionParameters
        }
    }


    const generateConditionPlaceholder = (queryObj = []) => {
        const [field, operator, value] = queryObj;

        let modifiedOperator = operator;
        let modifiedValue = value;
        let modifiedKey = mapperKeys.hasOwnProperty(field) ? mapperKeys[field] : field;

        if (value) {
            if (dateColumnList.includes(field)) {
                modifiedValue = value / 1000  // Convert milliseconds to seconds
            }
            else if (binaryUuidColumnList.includes(field)) {
                modifiedKey = `BIN_TO_UUID(${modifiedKey})`;
            }
        }

        switch (operator) {
            case 'contains':
                if (Array.isArray(value)) {
                    modifiedOperator = 'IN';
                } else {
                    modifiedOperator = 'LIKE';
                    modifiedValue = '%' + value + '%';
                }
                break;
            case 'notcontains':
                modifiedOperator = 'Not LIKE';
                modifiedValue = '%' + value + '%';
                break;
            case 'startswith':
                modifiedOperator = 'LIKE';
                modifiedValue = value + '%';
                break;
            case 'endswith':
                modifiedOperator = 'LIKE';
                modifiedValue = '%' + value;
                break;
            //.... Other case need to right here
        }

        let placeholder = '';

        if (Array.isArray(modifiedValue)) {
            placeholder = `(${modifiedKey} ${modifiedOperator} (?)  OR ?)`;

            if (modifiedValue.length > 0) {
                conditionParameters.push(modifiedValue);
                conditionParameters.push(false);     //In this case (?) will appliy
            }
            else {
                conditionParameters.push(null);
                conditionParameters.push(true); //In this case OR ? will appliy
            }
        } else {
            placeholder = `${modifiedKey} ${modifiedOperator} ?`;
            conditionParameters.push(modifiedValue);
        }

        return placeholder;
    }

    if (Array.isArray(queryObj)) {
        //For single level filter params ['name', 'contains', 'hi']
        if (queryObj.length == 3 && !queryObj.includes('and') && !queryObj.includes('or')) {
            const placeholder = generateConditionPlaceholder(queryObj);

            return {
                condition: placeholder ? `WHERE ${placeholder}` : '',
                conditionParameters
            }
        }
        //For multi-level filter params [["itemUUID","contains","33"],"and",["categoryName","contains","44"]]
        else {
            const generateMultiConditionPlaceholder = (queryObj) => {
                let placeholders = queryObj.map(x => {
                    if (Array.isArray(x)) {
                        //Ex: ["tagName","contains","psa"]
                        if (x.length == 3 && !x.includes('and') && !x.includes('or')) {
                            const placeholder = generateConditionPlaceholder(x);
                            return `(${placeholder})`;
                        }
                        //Ex: [["itemUpdatedAt",">=",1696059780000],"and",["itemUpdatedAt","<",1696059840000]]
                        else if (x.includes('and') || x.includes('or')) {
                            const conditions = generateMultiConditionPlaceholder(x);

                            return `(${conditions})`;
                        }
                    }
                    else if (x == 'and' || x == 'or') {
                        return x.toUpperCase();
                    }
                }).join(' ');

                return placeholders;
            }

            const placeholders = generateMultiConditionPlaceholder(queryObj);

            return {
                condition: placeholders ? `WHERE ${placeholders}` : '',
                conditionParameters
            }
        }
    }

    return '';
}