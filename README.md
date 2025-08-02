# notion-api
Integrates Google Books API and Goodreads web scraping to input book data into a Notion database.

## How It Works
1. Searches through your Books database to filter for pages with an ISBN but no Names (aka the book title)
2. Using the Google API, it extracts the title, first author (in title case), publication year, and ISBN
3. Scrapes web data from Goodreads and extracts the average rating, number of ratings, series name, number in series, image link for cover, and the first four most tagged genres
4. Checks if a page for the book exists in the Series database. If one does, it updates the page. If not, it creates a new page.
5. Creates the Amazon and Goodreads link with the ISBN info
6. Inputs all this info into the Book and Series databases

# Installation
Organized in this order:
1. Create & Retrieve NOTION_KEY
2. Get NOTION_DATABASE_ID & SERIES_DATABASE_ID
3. Clone & Edit GitHub Repo
4. Run code

Skip to whichever section you need
   
## Create & Retrieve NOTION_KEY
Open this link [Notion API](https://www.notion.so/profile/integrations)

Log into your Notion account and click "New integration"
* Add any integration name
* Select your workspace under "Associated workspace"
* Set Type as **Internal**
* Then, hit **Save**

Now, you should have a new Integration key.

Click it and find **Internal Integration Secret**. That will be your NOTION_KEY

## Get NOTION_DATABASE_ID & SERIES_DATABASE_ID
Duplicate this template for the Books & Series databases [template](https://gentle-catmint-460.notion.site/Book-Tracker-Template-223502ca107a80c19eeaffd38cb0c861?pvs=143)

The database ID from "Book List" will be NOTION_DATABASE_ID
The database ID from "Series List" will be SERIES_DATABASE_ID

To retrieve the IDs, use this [tutorial from Notion](https://developers.notion.com/reference/retrieve-a-database)

## Clone & Edit GitHub Repo




