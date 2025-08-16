const axios = require('axios');
const { Client } = require('@notionhq/client');
const cheerio = require('cheerio');
const fs = require("fs");
const yaml = require('js-yaml');
const readline = require('readline-sync');
const puppeteer = require('puppeteer');

const configFile = fs.readFileSync('./config.yaml', 'utf8');
const config = yaml.load(configFile);

const NOTION_KEY = config.notion.key;
const NOTION_DATABASE_ID = config.notion.books_database_id;
const SERIES_DATABASE_ID = config.notion.series_database_id;
const GENRES_DATABASE_ID = config.notion.genres_database_id;

const notion = new Client({auth: NOTION_KEY});
const bookData = [];
const bookArray = [];
const genreRelations = [];

// Prompts users on which book Status they are updating in the Book database
async function updateStatus() {
  readline.setDefaultOptions({limit: ['TBR', 'Reading', 'Finished', 'DNF']});
  var bookStatus = readline.question("\nAre you adding your to-be-read (TBR), in progress (Reading), completed (Finished), or did-not-finish (DNF) books? (TBR, Reading, Finished, DNF) \n");
  console.log("\n");

  return bookStatus
}

// Pause to give Notion time to process (Hopefully bypasses Error 409)
const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
};

// Scrapes data from Goodreads
async function scrapeSite(keyword) {
  const url = `https://www.goodreads.com/search?q=${keyword}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  return $
};

// If a page for the book exists in the Series database, updates the page. If not, creates a new page.
async function getOrCreateSeriesPage(seriesName, coverImage, author) {
  if (!seriesName) return null;

  // 1. Search for a page in the Series database with this name
  const search = await notion.databases.query({
    database_id: SERIES_DATABASE_ID,
    filter: {
      property: 'Name',
      title: {
        contains: seriesName
      }
    }
  });

  if (search.results.length > 0) {
    // Page exists, return its ID
    return search.results[0].id;
  }

  // 2. Doesn't exist — create a new page
  const newPage = await notion.pages.create({
    parent: { database_id: SERIES_DATABASE_ID },
    "icon": {
        "type": "emoji",
        "emoji": "📚"
      },
    properties: {
      'Name': {
        title: [
          {
            text: {
              content: seriesName
            }
          }
        ]
      },
      "Cover": {
        "files": [
          {
            "type": "external",
            "name": "Book Cover",
            "external": {
              "url": coverImage
            }
          }
        ]
      },
      "Author": {
        "rich_text": [
          {
            "type": "text",
            "text": {
              "content": author
            }
          }
        ]
      },
    }
  });
  
  await sleep(200);
  return newPage.id;
};

async function getOrCreateGenresPage(genresName) {
  if (!genresName) return null;

  // Search for a page in the Genres database with this name
  const search = await notion.databases.query({
    database_id: GENRES_DATABASE_ID,
    filter: {
      property: 'Name',
      title: {
        contains: genresName
      }
    }
  });

  if (search.results.length > 0) {
    // Page exists, return its ID
    return search.results[0].id;
  }

  // if the page doesn't exist, create a new page
  const newPage = await notion.pages.create({
    parent: { database_id: GENRES_DATABASE_ID },
    "icon": {
        "type": "emoji",
        "emoji": "🏷️"
      },
    properties: {
      'Name': {
        title: [
          {
            text: {
              content: genresName
            }
          }
        ]
      },
      }
  });
  
  await sleep(200);
  return newPage.id;
};

// Splits text at every paragraph break since Notion has a character limit of 2000
function splitBlock(str, title){
  const splitError = false;
  const paraBreak = "\n";
  const msg = `Unable to retrieve descrption for ${title} because at least one paragraph is over 2000 characters in length.`;

  const result = str.split(paraBreak);
  result.forEach((obj) => 
    {
      if (obj.length >= 2000) {
        splitError = true;
        console.log(msg);
      }
    }
  );

  return splitError ? msg : result;
};

// Helper function to convert a string to sentence case
function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
};

// Push first four genre tags into genresArray array
async function firstFourGenres(result) {
  const genresArray = []; 
  result('.BookPageMetadataSection__genreButton').each((i,el) => {
    if (i > 3) return false;
    const genre = result(el)
      .find('.Button__labelItem')
      .text();
    
    genresArray.push(genre);
  });

  return genresArray;
};

// Gets the book's shelf URL from the site's HTML
async function getShelfURL(res){
  
  const jsonText = res('#__NEXT_DATA__').html(); // or use .text()
  const datatwo = JSON.parse(jsonText);
  const apolloState = datatwo.props.pageProps.apolloState;

  // You can either loop or directly reference if you know the work ID key
  const shelveURL = Object.values(apolloState)
    .find(obj => obj?.__typename === 'Work' && obj?.details?.shelvesUrl)?.details?.shelvesUrl;
  console.log('Shelve URL:', shelveURL);

  return shelveURL
};

// Gets the book's shelf HTML from the shelf's URL
async function getShelfHTML(url){
  // Launching a headless browser
  const browser = await puppeteer.launch();

  // Creating a new page
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
  );
  
  
  // Navigating to a website
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 3000)); // give it time to render

  // Getting the page source HTML
  const pageSourceHTML = await page.content();

  // Closing the browser
  await browser.close();

  return pageSourceHTML;
}

// Runs through the first 50 tags and checks if any are Kindle Unlimited
async function checkKU(result) {
  const shelfURL = await getShelfURL(result);
  const rawHTML = await getShelfHTML(shelfURL);
  const shelfHTML = cheerio.load(rawHTML);
  let existsKU = false;

  shelfHTML('.shelfStat a').each((i,el) => {
    if (i > 50) return false;
    const shelf = shelfHTML(el).html();
    if (shelf === 'kindle-unlimited' || shelf === 'ku'){
      console.log(`This book is on Kindle Unlimited`);
      existsKU = true;
      return false;
    }
  });

  if (existsKU === false){
    console.log(`This book is not on Kindle Unlimited`);
  }
  return existsKU;
};

// Extracts the page id, title, first author (in title case), number of pages, publication year, and isbn from the volumeInfo
async function getGoogleBooks(pageid, isbn, response) {
  // Capitalizes the author's name
  const newAuthor = toTitleCase(response.data.items[0].volumeInfo.authors[0]) ?? "Unknown";

  const bookIndex = {
    "page-id": pageid,
    "title": response.data.items[0].volumeInfo.title ?? "Unknown",
    "author": newAuthor,
    "publication": response.data.items[0].volumeInfo.publishedDate?.slice(0,4) ?? "Unknown",
    "isbn": isbn
  };
  
  console.log(`\nFetched ${bookIndex.title}.`);      
  bookArray.push(bookIndex);
};

// If Google Books doesn't work, gets info from Goodreads
async function initGoodreads(pageid, isbn, response) {
  const title = response('.BookPageTitleSection__title h1').html();
  const author = response('.ContributorLink__name').html();
  const rawPublication = response('.FeaturedDetails').find('p[data-testid="publicationInfo"]').html();
  const publicationYear = rawPublication.slice(rawPublication.length-4, rawPublication.length);

  const bookIndex = {
    "page-id": pageid,
    "title": title ?? "Unknown",
    "author": author,
    "publication": publicationYear ?? "Unknown",
    "isbn": isbn
  };
  
  console.log(`\nFetched ${bookIndex.title}.`);
  bookArray.push(bookIndex);
};

// Extracts the average rating, number of ratings, series name, number in series, image link for cover, and the first four most tagged genres
async function getGoodreads(isbn, result){
  const Description = result('.BookPageMetadataSection__description');
  const refinedDes = Description.find('span[class="Formatted"]').html()
    .replace(/<br\s*\/?>/gi, '\n')         // HTML <br> to line break
    .replace(/<\/?[^>]+(>|$)/g, '')        // remove all other tags
    .replace(/&nbsp;/gi, ' ')              // encoded &nbsp;
    .replace(/\u00A0/g, ' ')               // decoded non-breaking spaces
    .replace(/^[\s\u00A0]+/, '')           // leading whitespace of all types
    .replace(/\n[ \t]+/g, '\n')            // strip space after line breaks
    .trim();                               // final cleanup
  const pageCount = result('.FeaturedDetails').find('p[data-testid="pagesFormat"]').text().replace(',', '').split(' ')[0];

  const newGenresArray = await firstFourGenres(result);
  const isKU = await checkKU(result);

  
  // Match: everything before the #, and the number after it
  const output = result('.BookPageTitleSection__title a')?.text().trim();
  const match = output.match(/^(.*)\s+#?(\d+)$/);

  let seriesName, seriesNumber;
  if (match) {
    seriesName = match[1].trim();     // "The Stormlight Archive"
    seriesNumber = match[2];          // "1" (without the #)
  } else {
    seriesName = output;
    seriesNumber = null;
  }

  const data = bookArray.find(obj => obj.isbn === isbn);
  data["avg-Rating"] = parseFloat(result('.RatingStatistics__rating').html()) || 0;
  data["numRating"] = result('.RatingStatistics__meta').find('span[data-testid="ratingsCount"]').contents().first().text().trim();
  data["series-name"] = seriesName;
  data["series-number"] = parseFloat(seriesNumber); 
  data["imageLink"] = result('.BookCover__image img.ResponsiveImage').attr('src');
  data["genres"] = newGenresArray;
  data["amazon-link"] = `https://www.amazon.com/s?k=${isbn}`;
  data["goodreads-link"] = `https://www.goodreads.com/search?q=${isbn}`;
  data["description"] = splitBlock(refinedDes);
  data["page-count"] = Number(pageCount) ?? 0;
  data["is-KU"] = isKU;

  console.log(`Fetched ${data["title"]}. ISBN: ${data["isbn"]}`);

};

// Filters ISBNs with empty titles and puts them into bookData array
async function getISBN() {
  const databaseId = NOTION_DATABASE_ID;

  // Searches through Notion database filtering for ISBNs with empty titles
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        {
          property: 'Name',
          title: {
            is_empty: true,
          },
        },
        {
          property: 'ISBN',
          rich_text: {
            is_not_empty: true,
          },
        },
      ]
    },
  });

  // Collects all ISBNs from filtered results
  response.results.forEach((result) => {
    bookData.push({
      id : result.id,
      isbn : result.properties.ISBN.rich_text[0]?.plain_text
    });   
  });

  console.log(bookData);

};

// Does everything... modularize further
async function getBook(bookData) {
  for (const book of bookData) {
    const pageid = book.id;
    const isbn = book.isbn;
    const scrapeResult = await scrapeSite(isbn);

    try {
      const response = await axios.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      await getGoogleBooks(pageid, isbn, response);

    } catch (error) {
      console.log(`Error retrieving data for ISBN ${isbn}:`, error);
      console.log(`Trying to get information from Goodreads`);
      try {
        await initGoodreads(pageid, isbn, scrapeResult);
      } catch (error){
        console.log(`Error retrieving HTML for ISBN ${isbn}:`, error);
      }
    }

    try {
      await getGoodreads(isbn, scrapeResult);
    } catch (error) {
      console.log(`Error retrieving HTML for ISBN ${isbn}:`, error);
    }
  }  
};

async function updateNotion(bookArray, status){
  // Get final array that will be used for Notion page update
  console.log(bookArray);

  for (const val of bookArray){
    console.log(`Page ID: ${val["page-id"]} ISBN: ${val["isbn"]}`);
    
    await sleep(200);

    const seriesPageId = await getOrCreateSeriesPage(val["series-name"], val["imageLink"], val["author"]);
    for (var genres of val["genres"]){
      const id = await getOrCreateGenresPage(genres);
      genreRelations.push({ id });
    }

    const paragraphBlocks = Array.isArray(val["description"])
    ? val["description"].map(description => ({
        "paragraph": {
        "rich_text": [
          {
            "text": {
              "content": description,
            }
          }
        ]
        }
      }))
    : [];

    const pageId = val["page-id"];
    await sleep(500);

    const res = await notion.pages.update({
      page_id: pageId,
      "icon": {
          "type": "emoji",
          "emoji":"📕"
        },
      properties: {
        "Name": {
          "id": "title",
          "type": "title",
          "title": [
            {
              "type": "text",
              "text": {
                "content": val["title"],
                "link": null
              },
              "annotations": {
                "bold": false,
                "italic": false,
                "strikethrough": false,
                "underline": false,
                "code": false,
                "color": "default"
              },
            }
          ]
        },
        "Author":{
          "rich_text": [
            {
              "type": "text",
              "text":{
              "content": val["author"],
              "link": null
              },
              "annotations": {
                "bold": false,
                "italic": false,
                "strikethrough": false,
                "underline": false,
                "code": false,
                "color": "default"
              }
            }
          ]
        },
        "Pages": {
          "number": val["page-count"]
        },
        "KU?": {
          "checkbox": val["is-KU"]
        },
        "Publication Date":{
          "rich_text": [
            {
              "type": "text",
              "text":{
              "content": val["publication"] || "Unknown"
              },
              "annotations": {
                "bold": false,
                "italic": false,
                "strikethrough": false,
                "underline": false,
                "code": false,
                "color": "default"
              }
            }
          ]
        },         
        "Cover": {
          "files": [
            {
              "name": "Cover",
              "external": {
                "url": val["imageLink"]
              }
            }
          ]
        },
        "Genres": {
          "multi_select": Array.isArray(val["genres"])
          ? val["genres"].map(genre => ({ name: genre }))
          : []
        },
        "Average Rating": {
          "number": val["avg-Rating"]
        },
        "Number of Ratings":{
          "rich_text": [
            {
              "type": "text",
              "text":{
              "content": val["numRating"],
              },
              "annotations": {
                "bold": false,
                "italic": false,
                "strikethrough": false,
                "underline": false,
                "code": false,
                "color": "default"
              }
            }
          ]
        },
        "Series Number": {
          "number": val["series-number"]
        },
        "Links": {
          "files": [
            {
              "name": "Amazon",
              "external": {
                "url": val["amazon-link"]
              }
            },
            {
              "name": "Goodreads",
              "external": {
                "url": val["goodreads-link"]
              }
            }
          ]
        },
        "Series": {
          relation: seriesPageId
            ? [{ id: seriesPageId }]
            : []  // leave empty if series name is null
        },
        "Status": {
          "status": {
            "name": status
          }
        },
        "Genres Database":{
          relation: genreRelations
            ? genreRelations
            : []
        }
      },
    });

    const response = await notion.blocks.children.append({
      block_id: pageId,
      "children": [
        {
          "heading_2": {
            "rich_text": [
              {
                "text": {
                  "content": "Book Summary"
                }
              }
            ]
          }
        },
        ...paragraphBlocks
      ]
    });

    await sleep(400);
  };
};

async function main() {
  const bookStatus = await updateStatus();
  await getISBN();
  await getBook(bookData);
  await updateNotion(bookArray, bookStatus);
};

main();
