/**
 * ========================================================
 * GOOGLE DRIVE OWNERSHIP TRANSFER - WEB APP
 * ========================================================
 * 
 * This creates a web app with UI for transferring files
 * Anyone with the link can use it with their own Google account
 * 
 * DEPLOYMENT STEPS:
 * 1. Go to https://script.google.com/
 * 2. Create new project
 * 3. Create two files:
 *    - Code.gs (paste this file)
 *    - Index.html (paste the HTML file)
 * 4. Click Deploy → New Deployment
 * 5. Select "Web app"
 * 6. Execute as: "User accessing the web app"
 * 7. Who has access: "Anyone" or "Anyone with Google Account"
 * 8. Click Deploy and copy the URL
 * 
 * ========================================================
 */

/**
 * Serve the HTML page
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Drive Ownership Transfer')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Get current user's email
 */
function getCurrentUser() {
  return Session.getActiveUser().getEmail();
}

/**
 * Get all files and folders owned by the current user
 */
function getMyFilesAndFolders() {
  const items = [];
  
  // Get all folders
  const folders = DriveApp.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    try {
      // Check if user owns this folder
      if (folder.getOwner() && folder.getOwner().getEmail() === Session.getActiveUser().getEmail()) {
        items.push({
          id: folder.getId(),
          name: folder.getName(),
          type: 'folder',
          mimeType: 'application/vnd.google-apps.folder',
          size: '-',
          modifiedDate: folder.getLastUpdated().toISOString()
        });
      }
    } catch (e) {
      // Skip if can't access
    }
  }
  
  // Get all files
  const files = DriveApp.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    try {
      // Check if user owns this file
      if (file.getOwner() && file.getOwner().getEmail() === Session.getActiveUser().getEmail()) {
        items.push({
          id: file.getId(),
          name: file.getName(),
          type: 'file',
          mimeType: file.getMimeType(),
          size: file.getSize(),
          modifiedDate: file.getLastUpdated().toISOString()
        });
      }
    } catch (e) {
      // Skip if can't access
    }
  }
  
  return items;
}

/**
 * Get contents of a specific folder recursively
 */
function getFolderContents(folderId) {
  const items = [];
  
  try {
    const folder = DriveApp.getFolderById(folderId);
    
    // Get files in folder
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      items.push({
        id: file.getId(),
        name: file.getName(),
        type: 'file'
      });
    }
    
    // Get subfolders and their contents
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const subfolder = subfolders.next();
      items.push({
        id: subfolder.getId(),
        name: subfolder.getName(),
        type: 'folder'
      });
      // Recursively get subfolder contents
      const subItems = getFolderContents(subfolder.getId());
      items.push(...subItems);
    }
  } catch (e) {
    console.error('Error getting folder contents: ' + e.message);
  }
  
  return items;
}

/**
 * Transfer ownership of files/folders to new owner
 * @param {string[]} itemIds - Array of file/folder IDs to transfer
 * @param {string} newOwnerEmail - Email of new owner
 * @param {boolean} shareMode - true = share only, false = transfer ownership
 */
function transferItems(itemIds, newOwnerEmail, shareMode) {
  const results = {
    success: [],
    failed: [],
    total: 0
  };
  
  // Build complete list including folder contents
  let allItems = [];
  
  for (const itemId of itemIds) {
    allItems.push(itemId);
    
    // Check if it's a folder and get contents
    try {
      const folder = DriveApp.getFolderById(itemId);
      const contents = getFolderContentsFlat(folder);
      allItems = allItems.concat(contents);
    } catch (e) {
      // Not a folder, continue
    }
  }
  
  results.total = allItems.length;
  
  // Process each item
  for (const itemId of allItems) {
    try {
      if (shareMode) {
        // Share mode - add as editor
        try {
          const file = DriveApp.getFileById(itemId);
          file.addEditor(newOwnerEmail);
          results.success.push({ id: itemId, name: file.getName() });
        } catch (e1) {
          try {
            const folder = DriveApp.getFolderById(itemId);
            folder.addEditor(newOwnerEmail);
            results.success.push({ id: itemId, name: folder.getName() });
          } catch (e2) {
            results.failed.push({ id: itemId, error: e2.message });
          }
        }
      } else {
        // Transfer ownership mode
        try {
          const file = DriveApp.getFileById(itemId);
          file.setOwner(newOwnerEmail);
          results.success.push({ id: itemId, name: file.getName() });
        } catch (e1) {
          if (e1.message.includes('cannot transfer ownership') || 
              e1.message.includes('setOwner')) {
            results.failed.push({ id: itemId, error: 'Ownership transfer only works within same Google Workspace domain. Try Share Mode.' });
          } else {
            results.failed.push({ id: itemId, error: e1.message });
          }
        }
      }
    } catch (e) {
      results.failed.push({ id: itemId, error: e.message });
    }
  }
  
  return results;
}

/**
 * Get all items in a folder (flat list)
 */
function getFolderContentsFlat(folder) {
  const items = [];
  
  // Get files
  const files = folder.getFiles();
  while (files.hasNext()) {
    items.push(files.next().getId());
  }
  
  // Get subfolders recursively
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    items.push(subfolder.getId());
    items.push(...getFolderContentsFlat(subfolder));
  }
  
  return items;
}
