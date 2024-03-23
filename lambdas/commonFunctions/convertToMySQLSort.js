exports.convertToMySQLSort = (sort, defaultSort = '', mapperKeys = {}) => {
    const sortObj = sort ? JSON.parse(sort) : '';

    let sortStr = '';
    if (Array.isArray(sortObj)) {
        sortStr = sortObj.map(x => (`${mapperKeys.hasOwnProperty(x.selector) ? mapperKeys[x.selector] : x.selector} ${x.order}`)).join(', ')
    }

    if (sortStr) sortStr = `ORDER BY ${sortStr}`;
    else if (defaultSort) sortStr = `ORDER BY ${defaultSort}`;
    else sortStr = '';

    return sortStr;
}