const parser = new DOMParser();

const chromeStorageKeys = ['excludeKeys', 'strataMax', 'preferences', 'otherPreference', 'blacklist'];

const strataRegex = /(?<=strata.*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const strataMaxValue = 2000;

const preferencesMap = new Map([
    ['Gym', 'gym|fitness.{0,10}center|exercise'],
    ['Pool', 'pool|swimming|jacuzzi|hot.{0,10}tub'],
    ['Spa', 'spa|sauna|steam.{0,10}room'],
    ['Dishwasher', 'dishwasher'],
    ['Dryer', 'dryer'],
    ['Glazed Windows', 'double.{0,10}glazed|glazed.{0,10}window|soundproof'],
    ['Electric Stove', '(electric|induction){0,10}{stove|cook\s?top}']
]);

const preferredAllColor = '#e7bc4f';
const preferredHalfColor = '#e2e74f';
const preferredSomeColor = '#9cc22e';
const preferredLittleColor = '#6daf25';

const urlParams = new URLSearchParams(window.location.search);

const isHome = window.location.href === 'https://www.domain.com.au/';
const isListing = /^https:\/\/www\.domain\.com\.au\/(?!sale|rent)(.+)/.test(window.location.href);
const isSaleOrRent = /^https:\/\/www\.domain\.com\.au\/(sale|rent)/.test(window.location.href);
const isShortlist = window.location.href.startsWith('https://www.domain.com.au/user/shortlist')
const isBlacklist = (urlParams.get('blacklist') ?? '0') === '1';

let isStudioType;

const crossSvg = `
                <g stroke-linecap="round" stroke-linejoin="round" transform="matrix(1.153397, 0, 0, 1.153397, -1.840759, -1.840759)">
                    <path d="M 6.042 17.958 L 17.958 6.042" style="transform-origin: 50% 50%; stroke-width: 2.5px;" transform="matrix(0, 1, -1, 0, 0, 0.000001)"/>
                    <path d="M 6.042 6.042 L 17.958 17.958" style="transform-origin: 50% 50%; stroke-width: 2.5px;" transform="matrix(0, 1, -1, 0, 0, 0.000001)"/>
                </g>
                `;

let listingCoords = {}
let listings;

let parseCardsTimer;
let cardChange = new Set();
const listObserver = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            Array.from(mutation.addedNodes)
                .filter(card => card.nodeType === Node.ELEMENT_NODE)
                .forEach(card => cardChange.add(card));

            await scheduleParseCards();
        }
    }
});

let markers;

let parseMarkersTimer;
let markerChange = new Set();
const mapObserver = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            Array.from(mutation.addedNodes)
                .filter(marker => marker.nodeType === Node.ELEMENT_NODE)
                .forEach(marker => markerChange.add(marker));

            await scheduleParseMarkers();
        }
    }
});

console.log('Domain extension loaded');

(async () => {
    await injectDoc();
})();

async function injectDoc() {
    await injectBase();

    if (isHome) { // *://www.domain.com.au
        const filterButton = document.querySelector('button[data-testid*="search-filters-button"]')
        filterButton.addEventListener('click', () => {
            const observer = new MutationObserver(() => {
                const filters = document.querySelectorAll('[data-testid*="dynamic-search-filters"]');
                if (filters.length > 0) {
                    injectHome();
                    observer.disconnect();
                }
            })
            observer.observe(document.body, { childList: true, subtree: true });
        })
    } else if (isShortlist) { // *://www.domain.com.au/user/shortlist?blacklist=1
        if (isBlacklist) {
            await injectBlacklist();
        }
    } else if (isListing) { // *://www.domain.com.au/[listing-address]-[listing-id]
        await injectListing();
    } else if (isSaleOrRent) { // *://www.domain.com.au/sale or *://www.domain.com.au/rent
        await injectHome();
        await injectSearch();
    }
}

async function injectBase() {
    const desktopMenu = document.querySelector('nav').firstChild;
    const mobileMenu = document.querySelector('nav').firstChild;

    let desktopButton = document.querySelector('button[aria-label="User profile"]');
    let mobileButton = document.querySelector('button[data-testid="mobile-nav__secondary-toggle"]');

    if (desktopButton) desktopButton.addEventListener('click', () => handleDesktopMenu(desktopMenu));
    if (mobileButton) mobileButton.addEventListener('click', () => handleMobileMenu());

    const desktopMenuObserver = new MutationObserver(async () => {
        const newDesktopButton = document.querySelector('button[aria-label="User profile"]');
        if (newDesktopButton && !document.contains(desktopButton)) {
            desktopButton = newDesktopButton;
            desktopButton.addEventListener('click', () => handleDesktopMenu(desktopMenu));
        }
    });
    desktopMenuObserver.observe(desktopMenu, { childList: true, subtree: true });

    const mobileMenuObserver = new MutationObserver(async () => {
        const newMobileButton = document.querySelector('button[data-testid="mobile-nav__secondary-toggle"]');
        if (newMobileButton && !document.contains(mobileButton)) {
            mobileButton = newMobileButton;
            mobileButton.addEventListener('click', () => handleMobileMenu());
        }
    });
    mobileMenuObserver.observe(mobileMenu, { childList: true, subtree: true });


}

function handleDesktopMenu(desktopMenu) {
    const profileObserver = new MutationObserver(async () => {
        const memberDropdown = document.querySelector('[data-testid="header-member__dropdown"]');
        if (!memberDropdown) return;
        const dropdownList = memberDropdown.querySelector('ul');
        if (!dropdownList) return;

        if (!dropdownList.querySelector('.blacklist-item')) {
            dropdownList.children[0].after(createBlacklistItem());
        }
        profileObserver.disconnect();
    });
    profileObserver.observe(desktopMenu, {childList: true, subtree: true});
}

function handleMobileMenu() {
    const memberDropdown = document.querySelector('nav[data-testid="mobile-nav"][class="css-1o8190c"]');
    if (!memberDropdown) return;
    const dropdownList = memberDropdown.querySelector('ul');
    if (!dropdownList) return;
    if (!dropdownList.querySelector('.blacklist-item')) {
        dropdownList.children[1].after(createBlacklistItem());
    }
}

function createBlacklistItem() {
    const item = document.createElement('li');
    item.classList.add('blacklist-item', 'css-nec8yl');

    const anchor = document.createElement('a');
    anchor.classList.add('css-10ncok4', 'css-mzmifu');
    anchor.href = 'https://www.domain.com.au/user/shortlist?blacklist=1';
    item.appendChild(anchor);

    anchor.textContent = 'Blacklist';

    const svg = createSvg();
    svg.innerHTML = crossSvg;
    anchor.prepend(svg);

    const span = document.createElement('span');
    span.classList.add('css-1cmks7q');
    anchor.appendChild(span);
    getDataWithRetry(['blacklist']).then(({ blacklist }) => {
        const len = blacklist?.length ?? 0;
        span.textContent = len;
        span.style.display = len ? '' : 'none';
    });
    chrome.storage.local.onChanged.addListener(({blacklist}) => {
        const len = blacklist?.length ?? 0;
        span.textContent = len;
        span.style.display = len ? '' : 'none';
    });

    svg.style.stroke = isBlacklist ? '#0EA800' : '#3C475B';
    anchor.style.color = isBlacklist ? '#0EA800' : '#3C475B';
    span.style.color = isBlacklist ? '#0EA800' : '#3C475B';

    if (!isBlacklist) {
        anchor.addEventListener('mouseenter', () => {
            svg.style.stroke = '#0EA800';
            anchor.style.color = '#0EA800';
            span.style.color = '#0EA800';
        });
        anchor.addEventListener('mouseleave', () => {
            svg.style.stroke = '#3C475B';
            anchor.style.color = '#3C475B';
            span.style.color = '#3C475B';
        });
    }
    return item;
}

function createSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.classList.add('domain-icon', 'css-jeyium');
    return svg;
}

async function injectHome() {
    //await loadFiltersFromURL();

    const keywordDiv = document.querySelector('[data-testid="dynamic-search-filters__keywords"]');

    const includeH3 = keywordDiv.children[0];

    const excludeH3 = includeH3.cloneNode(true);
    const excludeInput = keywordDiv.children[1].cloneNode(true).children[0];

    // Modify include and exclude keyword filters
    includeH3.textContent = 'Include Keywords';
    excludeH3.textContent = 'Exclude Keywords';
    excludeInput.name = 'exclude';
    excludeInput.placeholder = 'e.g. studios >w<';

    keywordDiv.append(excludeH3, excludeInput);

    chrome.storage.local.get('excludeKeys', (data) => excludeInput.value = data.excludeKeys ?? '');
    excludeInput.addEventListener('input', async (event) => {
        await chrome.storage.local.set({ excludeKeys: event.target.value });
        //await saveFiltersToURL();
    });
    chrome.storage.local.onChanged.addListener(({ exclude }) => {
        if (exclude) excludeInput.value = exclude.newValue ?? '';
    });

    // Modify price and strata slider filters
    const priceDivs = document.querySelectorAll('[data-testid="dynamic-search-filters__price-range"]');
    for (const priceDiv of priceDivs) {
        const strataDiv = priceDiv.cloneNode(true);
        const strataH3 = strataDiv.children[0];
        strataH3.textContent = 'Strata Fees (Quarterly)'
        configureStrataSlider(strataDiv);
        priceDiv.after(strataDiv);
    }

    // Modify features and preferences checkbox filters
    const featureDiv = document.querySelector('[data-testid="dynamic-search-filters__feature-options"]');
    const featureH3 = featureDiv.children[0];
    featureH3.textContent = 'Must-Haves';

    const preferenceDiv = featureDiv.cloneNode(true);
    const preferenceH3 = preferenceDiv.children[0];
    preferenceH3.textContent = 'Could-Haves';

    const prefabCheckbox = preferenceDiv.children[1];
    for (let i = preferenceDiv.children.length - 1; i > 0; i--) {
        preferenceDiv.removeChild(preferenceDiv.children[i]);
    }

    for (const [name, regex] of preferencesMap) {
        createPreferenceCheckbox(preferenceDiv, prefabCheckbox, name, regex);
    }

    const otherPreferenceInput = excludeInput.cloneNode(true);
    otherPreferenceInput.name = 'other_preference';
    otherPreferenceInput.placeholder = 'Other preferences';
    preferenceDiv.append(otherPreferenceInput);

    chrome.storage.local.get('otherPreference', (data) => otherPreferenceInput.value = data.otherPreference ?? '');
    otherPreferenceInput.addEventListener('input', async (event) => {
        await chrome.storage.local.set({ otherPreference: event.target.value });
        //await saveFiltersToURL();
    });
    chrome.storage.local.onChanged.addListener(({ otherPreference }) => {
        if (otherPreference) otherPreferenceInput.value = otherPreference.newValue ?? '';
    });

    const clearButtons = document.querySelectorAll('button[aria-label="Clear all filter selections"]');
    for (const button of clearButtons) {
        button.addEventListener('click', async () => {
            await chrome.storage.local.set({
                preferences: [],
                strataMax: strataMaxValue,
                otherPreference: '',
                excludeKeys: ''
            });
            console.log('All filters cleared');
        });
    }

    featureDiv.after(preferenceDiv);
}

async function injectListing() {
    const buttonGroup = document.querySelector('[data-testid="listing-details__gallery-buttons-group"]');
    const shortlistButton = document.querySelector('[data-testid^="listing-details__shortlist-button"]');
    if (shortlistButton) {
        const blacklistButton = shortlistButton.cloneNode(true);
        blacklistButton.setAttribute('data-testid', 'listing-details__blacklist-button');
        blacklistButton.classList.add('css-1ayo4s1');
        blacklistButton.classList.remove('css-6elhz5');

        const blacklistSvg = blacklistButton.children[0];
        blacklistSvg.setAttribute('data-testid', '');
        blacklistSvg.innerHTML = crossSvg;

        blacklistButton.children[1].textContent = 'Blacklist';

        let isBlacklisted;
        const baseColor = '#3c475b';
        const activeColor = '#ffa200';

        const url = window.location.origin + window.location.pathname;

        chrome.storage.local.get('blacklist', ({ blacklist }) => {
            isBlacklisted = updateBlacklist(blacklistButton, blacklist ?? [], url,
                false, baseColor, activeColor, activeColor);
        });
        blacklistButton.addEventListener('click', function (event) {
            chrome.storage.local.get('blacklist', async ({ blacklist }) => {
                let existingBlacklist = blacklist ?? [];
                if (existingBlacklist.includes(url)) existingBlacklist.splice(existingBlacklist.indexOf(url), 1);
                else existingBlacklist.push(url);

                await chrome.storage.local.set({ blacklist: existingBlacklist });
                //await saveFiltersToURL();
            });
            event.stopPropagation();
            event.preventDefault();
        });
        chrome.storage.local.onChanged.addListener(({ blacklist }) => {
            isBlacklisted = updateBlacklist(blacklistButton, blacklist.newValue ?? [], url,
                false, baseColor, activeColor, activeColor);
        });
        buttonGroup.appendChild(blacklistButton);
    }
}

async function injectSearch() {
    await observeSearch();
    const searchObserver = new MutationObserver(async () => {
        await observeSearch();
        //await saveFiltersToURL();
    });
    searchObserver.observe(document.querySelector('[data-testid="page"]'), { childList: true, subtree: true });

    const submitButtons = [
            ...document.querySelectorAll('button[type="submit"]'),
        document.querySelector('button[type="button"][aria-label="perform search"]')
    ];
    for (const submitButton of submitButtons) {
        submitButton.addEventListener('click', async () => {
            if (listings) await parseCards(listings.children);
            if (markers) await parseMarkers(markers.children);
        });
    }



    const allTypeInput = document.querySelector('input[type="checkbox"][name="All"]');
    const apartmentInput = document.querySelector('input[type="checkbox"][name="apartment"]');
    const studioInput = document.querySelector('input[type="checkbox"][name="apartment"][value="studio"]');
    if (allTypeInput) allTypeInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    apartmentInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    studioInput.addEventListener('input', () => handleTypeInput(allTypeInput, studioInput));
    handleTypeInput(allTypeInput, studioInput);
}

async function observeSearch() {
    const hasListings = document.querySelector('[data-testid="results"]');
    const hasMarkers = document.querySelector('[data-testid="single-marker"]')?.parentElement?.parentElement;

    if (!document.contains(listings)) {
        listings = null;
        listObserver.disconnect();
        if (hasListings) {
            listings = hasListings;
            console.log('List found', listings.children.length, 'listings');
            await parseCards(listings.children);
            listObserver.observe(listings, {childList: true, subtree: false});
        } else {
            console.log('No list found');
        }
    }
    if (!document.contains(markers)) {
        markers = null;
        mapObserver.disconnect();
        if (hasMarkers) {
            markers = hasMarkers;
            console.log('Map found with', markers.children.length, 'markers');
            await parseMarkers(markers.children);
            mapObserver.observe(markers, {childList: true, subtree: false});
        } else {
            console.log('No map found');
        }
    }
}

async function loadFiltersFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const excludeKeys = urlParams.get('exclude') ?? '';
        const strataMax = urlParams.get('stratamax') ? parseInt(urlParams.get('stratamax')) : strataMaxValue;
        const preferences = urlParams.get('preferences') ? urlParams.get('preferences').split(',') : [];

        await chrome.storage.local.set({excludeKeys, strataMax, preferences});
    } catch (e) {
        console.error('Error loading filters from url', e);
    }
}

async function saveFiltersToURL() {
    try {
        const url = new URL(window.location.href);
        const params = url.searchParams;

        const data = await getDataWithRetry(chromeStorageKeys)

        if (data.excludeKeys !== '') params.set('exclude', data.excludeKeys);
        else params.delete('exclude');

        if (data.strataMax !== strataMaxValue) params.set('stratamax', data.strataMax);
        else params.delete('stratamax');

        if (data.preferences && data.preferences.length > 0) params.set('preferences', data.preferences);
        else params.delete('preferences');

        window.history.pushState({}, '', url.toString());
    } catch (e) {
        console.error('Error saving filters to url', e);
    }
}

async function getDataWithRetry(keys, retries = 5, delay = 1000) {
    try {
        return await chrome.storage.local.get(keys);
    } catch (e) {
        if (retries <= 0) {
            throw new Error('Extension context invalidated after multiple retries.');
        } else {
            console.error(`Attempt accessing storage failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await getDataWithRetry(keys, retries - 1, delay);
        }
    }
}

function configureStrataSlider(sliderWrapper) {
    const sliderLabel = sliderWrapper.children[1];
    const sliderContainer = sliderWrapper.children[2];
    sliderContainer.style.marginLeft = '5px';
    const rheostatContainer = sliderContainer.querySelector('[class*="rheostat"]');
    const handleContainer = sliderContainer.querySelector('[class*="handleContainer"]');

    const background = rheostatContainer.children[0];
    background.style.marginLeft = '0px'
    const foreground = rheostatContainer.children[2];

    const handles = sliderContainer.querySelectorAll('button');
    handles[0].remove();
    const handle = handles[1];

    let isDragging = false;
    let startX = 0;
    let startPercent = 0;

    // Load strataMax values
    chrome.storage.local.get('strataMax', (data) => {
        const strataMax = data.strataMax ?? strataMaxValue;
        sliderShowValue(handle, foreground, sliderLabel, strataMax, strataMaxValue);
    });
    chrome.storage.local.onChanged.addListener(({ strataMax }) => {
        if (strataMax) sliderShowValue(handle, foreground, sliderLabel, strataMax.newValue, strataMaxValue);
    })

    handle.addEventListener('mousedown', (event) => {
        isDragging = true;
        startX = event.clientX;
        startPercent = (handle.offsetLeft / handleContainer.offsetWidth) * 100;
        event.preventDefault();
    })

    document.addEventListener('mousemove', (event) => {
        if (!isDragging) return;

        const deltaX = event.clientX - startX;
        let newPercent = startPercent + (deltaX / handleContainer.offsetWidth) * 100;
        newPercent = Math.max(0, Math.min(100, newPercent));
        handle.style.left = `${newPercent}%`;
        foreground.style.width = `${newPercent}%`;

        let newStrataMax = Math.round(newPercent / 100 * strataMaxValue);
        newStrataMax = Math.round(newStrataMax / 100) * 100;
        sliderLabel.textContent = newStrataMax === strataMaxValue ? 'Any' : `$${newStrataMax}`;
    });

    document.addEventListener('mouseup', async () => {
        if (isDragging) {
            let newStrataMax = Math.round((parseFloat(handle.style.left) / 100) * strataMaxValue);
            newStrataMax = Math.round(newStrataMax / 100) * 100;
            await chrome.storage.local.set({strataMax: newStrataMax});
            //await saveFiltersToURL();
        }
        isDragging = false;
    })
}

function sliderShowValue(handle, foreground, label, value, max) {
    let newPercent = value / max * 100;
    newPercent = Math.max(0, Math.min(100, newPercent));
    handle.style.left = `${newPercent}%`;
    foreground.style.width = `${newPercent}%`;
    label.textContent = value === max ? 'Any' : `$${value}`;
}

function createPreferenceCheckbox(container, prefab, name, regex) {
    const checkbox = prefab.cloneNode(true);
    const checkboxLabel = checkbox.querySelector('div[class*="domain-checkbox__label"]');
    const checkboxInput = checkbox.querySelector('input')

    checkboxLabel.textContent = name;
    container.appendChild(checkbox);

    chrome.storage.local.get('preferences', ({ preferences }) => {
        if (preferences) checkboxInput.checked = preferences.includes(regex)
    });
    checkboxInput.addEventListener('input', () => {
        chrome.storage.local.get('preferences', async ({ preferences }) => {
            let existingPreferences = preferences ?? [];

            if (existingPreferences.includes(regex)) existingPreferences.splice(existingPreferences.indexOf(regex), 1);
            else existingPreferences.push(regex);

            await chrome.storage.local.set({preferences: existingPreferences});
            //await saveFiltersToURL();
        });
    });
    chrome.storage.local.onChanged.addListener(({ preferences }) => {
        if (preferences) checkboxInput.checked = preferences.newValue.includes(regex);
    });
}

function handleTypeInput(allTypeInput, studioInput) {
    isStudioType = (allTypeInput && allTypeInput.checked) || studioInput.checked;
}

async function injectBlacklist() {
    const container = document.querySelector('#shortlist').children[0];
    const title = container.children[0];
    title.textContent = 'Your blacklist';
    title.style.paddingBottom = '10px';
    container.children[1].remove();
    container.children[2].remove();

    const titleWrapper = document.createElement('div');
    titleWrapper.style.display = 'flex';
    titleWrapper.appendChild(title);
    title.style.flexGrow = '1';
    container.appendChild(titleWrapper);

    const clearButton = document.createElement('button');
    clearButton.classList.add('clear-button');
    clearButton.textContent = 'Clear All';

    clearButton.addEventListener('click', () => {
        chrome.storage.local.set({ blacklist: [] });
    });
    titleWrapper.appendChild(clearButton);

    const list = document.createElement('div');
    list.classList.add('css-1j3pg80');

    chrome.storage.local.get('blacklist', async (data) => {
        for (const blacklist of (data.blacklist ?? [])) {
            const listingCard = createListingCard(blacklist, await parseListing(blacklist));
            listingCard.id = blacklist;
            list.appendChild(listingCard);
        }
    });
    container.appendChild(list);

    const documentObserver = new MutationObserver(async () => {
        const memberDropdown = document.querySelector('[data-testid="shortlist__message_wrapper"]');
        if (!memberDropdown) return;
        memberDropdown.remove();
        documentObserver.disconnect();
    });
    documentObserver.observe(document.body, { childList: true, subtree: true });

    document.title = 'Blacklisted properties';
}

function createListingCard(url, content) {
    const listingWrapper = document.createElement('div');
    listingWrapper.classList.add('css-eztut6');

    const listingContainer = document.createElement('div');
    listingContainer.classList.add('css-1iszjo9');
    listingContainer.style.paddingBottom = '0';

    const imageContainer = document.createElement('div');
    const image = document.createElement('img');
    image.style.width = '100%';
    image.src = content.images[0];
    imageContainer.appendChild(image);

    const infoContainer = document.createElement('div');
    infoContainer.classList.add('css-1n74r2t');

    const titleContainer = document.createElement('div');
    titleContainer.classList.add('css-9hd67m');
    const title = document.createElement('p');
    title.classList.add('css-mgq8yx');
    title.textContent = content.title;
    titleContainer.appendChild(title);

    const blacklist = createBlacklistButton(url, '#BBBEC4', '#fc0', '#ffa200');
    titleContainer.appendChild(blacklist);
    infoContainer.appendChild(titleContainer);

    const addressContainer = document.createElement('a');
    addressContainer.classList.add('css-1y2bib4');
    addressContainer.href = url;
    const address = document.createElement('h2');
    address.classList.add('css-bqbbuf');
    address.innerHTML = content.address.replace(', ', ',<br>');
    addressContainer.appendChild(address);
    infoContainer.appendChild(addressContainer);

    const layoutContainer = document.createElement('div');
    layoutContainer.classList.add('css-1t41ar7');

    listingWrapper.appendChild(listingContainer);
    listingContainer.appendChild(imageContainer);
    listingContainer.appendChild(infoContainer);

    return listingWrapper;
}

async function scheduleParseMarkers() {
    clearTimeout(parseMarkersTimer)

    parseMarkersTimer = setTimeout(async () => {
        if (markerChange.size === 0) return;
        await parseMarkers(markerChange);
        markerChange.clear();
    }, 500);
}

async function parseMarkers(markers) {
    if (markers.length === 0) return;
    console.log('Started parsing', markers.length, 'markers');

    const data = await getDataWithRetry(chromeStorageKeys);

    const pageData = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
    const listingsMap = pageData.props.pageProps.componentProps.listingsMap;

    listingCoords = [];
    for (const [_, listingData] of Object.entries(listingsMap)) {
        const url = 'https://www.domain.com.au' + listingData.listingModel.url;
        const lat = listingData.listingModel.address.lat;
        const lng = listingData.listingModel.address.lng;
        listingCoords.push({lat, lng, url});
    }

    const mapContainer = document.querySelector('[data-testid="google-map"]');
    const mapWidth = mapContainer.offsetWidth;
    const mapHeight = mapContainer.offsetHeight;

    const url = new URL(document.location.href);
    const params = url.searchParams;

    const northWest = decodeURIComponent(params.get('startloc')).split(',').map(ord => parseFloat(ord)); // Top-left corner of map
    const southEast = decodeURIComponent(params.get('endloc')).split(',').map(ord => parseFloat(ord)); // Bottom-right corner of map

    const markerListings = [];
    for (const marker of markers) {
        const markerCoord = pixelToCoordinates(marker.style.left, marker.style.top, mapWidth, mapHeight, northWest, southEast);
        const nearestListing = findNearestListing(markerCoord);
        if (nearestListing) markerListings.push({ marker, nearestListing });
    }

    const listingPromises = Array.from(markerListings).map(async markerListing => {
        const {marker, nearestListing} = markerListing;
        const blacklist = (data.blacklist ?? []).includes(nearestListing.url);
        if (blacklist) {
            marker.style.display = 'none';
            return marker;
        }

        const content = await parseListing(nearestListing.url);
        const exclude = await excludeListing(data, content);
        marker.style.display = exclude ? 'none' : '';
        if (exclude) return marker;

        const preferred = await preferListing(data, content);
        const preferredColor = preferColor(preferred);

        const rects = marker.querySelectorAll('rect');
        for (const rect of rects) {
            if (window.getComputedStyle(rect).fill === 'rgb(124, 124, 123)') continue;
            rect.style.fill = preferred > 0 ? preferredColor : '#0b6500';
        }
    });
    await Promise.all(listingPromises);
    console.log('Finished parsing', markers.length, 'markers');
}

function pixelToCoordinates(left, top, mapWidth, mapHeight, northWest, southEast) {
    const pixelX = parseFloat(left);
    const pixelY = parseFloat(top);

    const ratioX = pixelX / mapWidth;
    const ratioY = pixelY / mapHeight;

    const lat = northWest[0] + ratioY * (southEast[0] - northWest[0]);
    const lng = northWest[1] + ratioX * (southEast[1] - northWest[1]);

    return { lat, lng };
}

function findNearestListing(markerCoord) {
    let nearestListing;
    let minDistance = Infinity;

    for (const listingCoord of listingCoords) {
        const distance = Math.sqrt(Math.pow(markerCoord.lat - listingCoord.lat, 2)
            + Math.pow(markerCoord.lng - listingCoord.lng, 2));

        if (distance < minDistance) {
            nearestListing = listingCoord;
            minDistance = distance;
        }
    }

    return nearestListing;
}

async function scheduleParseCards() {
    clearTimeout(parseCardsTimer)

    parseCardsTimer = setTimeout(async () => {
        if (cardChange.size === 0) return;
        await parseCards(cardChange);
        cardChange.clear();
    }, 500);
}

async function parseCards(cards) {
    if (cards.length === 0) return;
    console.log('Started parsing', cards.length, 'cards');

    const data = await getDataWithRetry(chromeStorageKeys);

    const listings = new Map();
    for (const card of cards) {
        const anchors = card.getElementsByTagName('a');
        for (const anchor of anchors) {
            const container = anchor.closest('div[data-testid="listing-card-child-listing"], li[data-testid^="listing"], li[data-testid="topspot"], div[class^="slick-slide"]');
            if (!listings.has(container)) listings.set(container, anchor);
        }
    }

    for (const slickTrack of document.querySelectorAll('.slick-track')) {
        slickTrack.style.display = 'grid';
        slickTrack.style.gridTemplateColumns = `repeat(${slickTrack.children.length}, 1fr)`;
        slickTrack.style.gridAutoFlow = 'column';
    }

    const listingPromises = Array.from(listings).map(async ([container, anchor]) => {
        const blacklist = (data.blacklist?? []).includes(anchor.href);
        if (blacklist) {
            container.style.display = 'none';
            return;
        }

        const content = await parseListing(anchor.href)

        const exclude = await excludeListing(data, content);
        container.style.display = exclude ? 'none' : '';

        const preferred = await preferListing(data, content);
        const preferredColor = preferColor(preferred);

        if (preferred > 0) {
            if (container.getAttribute('data-testid') === 'listing-card-child-listing') { // child listing
                if (!container.parentElement.classList.contains('child-listing-wrapper')) {
                    const wrapperOfWrapper = container.parentElement;
                    wrapperOfWrapper.classList.add('css-hlnxku');

                    const wrapper = document.createElement('div');
                    wrapper.classList.add('child-listing-wrapper');
                    container.classList.remove('css-hlnxku');
                    anchor.style.textDecoration = 'none';
                    anchor.style.color = 'inherit';
                    container.style.backgroundColor = '#fff';

                    wrapper.appendChild(container);
                    wrapperOfWrapper.appendChild(wrapper);
                }
                const wrapper = container.parentElement;
                wrapper.style.backgroundColor = preferredColor;
                wrapper.style.padding = '6px';

            } else { // normal listing
                container.style.backgroundColor = preferredColor;
                container.style.padding = '10px';
            }
        } else {
            container.style.padding = '0px';
        }

        if (container.classList.contains('slick-slide')) {
            container.childNodes[0].style.height = '100%';
            container.childNodes[0].childNodes[0].style.height = '100%';
        }

        if (!container.querySelector('button[data-testid="listing-card-blacklist"]')) {
            const shortlistButton = container.querySelector('button[data-testid^="listing-card-shortlist"]');
            if (!shortlistButton) return;

            const baseColor = shortlistButton.parentElement.getAttribute('data-testid') === 'listing-card-price-wrapper'
                ? '#BBBEC4' : '#fff'
            shortlistButton.after(createBlacklistButton(anchor.href, baseColor, '#fc0', '#ffa200'));
        }
    });

    await Promise.all(listingPromises);
    console.log('Finished parsing', cards.length, 'cards');
}

function createBlacklistButton(href, baseColor, hoverColor, activeHoverColor) {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'listing-card-blacklist');
    button.classList.add('css-9xfbzc');
    button.style.background = 'none';
    button.style.border = '0';
    button.style.padding = '0';
    button.style.margin = '3px';
    const svg = createSvg();
    svg.innerHTML = crossSvg;
    button.appendChild(svg);

    let isBlacklisted;
    let isHovered = false;
    button.style.transition = "stroke 0.2s ease-in-out";

    chrome.storage.local.get('blacklist', ({ blacklist }) => {
        isBlacklisted = updateBlacklist(button, blacklist ?? [], href,
            isHovered, baseColor, hoverColor, activeHoverColor);
    });
    button.addEventListener('click', function (event) {
        chrome.storage.local.get('blacklist', async ({ blacklist }) => {
            let existingBlacklist = blacklist ?? [];
            if (existingBlacklist.includes(href)) existingBlacklist.splice(existingBlacklist.indexOf(href), 1);
            else existingBlacklist.push(href);

            await chrome.storage.local.set({ blacklist: existingBlacklist });
            //await saveFiltersToURL();
        });
        event.stopPropagation();
        event.preventDefault();
    });
    chrome.storage.local.onChanged.addListener(({ blacklist }) => {
        isBlacklisted = updateBlacklist(button, blacklist.newValue ?? [], href,
            isHovered, baseColor, hoverColor, activeHoverColor);
    });

    button.addEventListener('mouseenter', function () {
        button.style.stroke = isBlacklisted ? activeHoverColor : hoverColor;
        isHovered = true;
    });
    button.addEventListener('mouseleave', function () {
        button.style.stroke = isBlacklisted ? hoverColor : baseColor;
        isHovered = false;
    });
    return button;
}

function updateBlacklist(button, blacklist, href, isHovered, baseColor, hoverColor, activeHoverColor) {
    if (blacklist && blacklist.includes(href)) {
        button.classList.remove('css-1n8tzw1');
        button.classList.add('css-7teszh');
        button.style.stroke = isHovered ? activeHoverColor : hoverColor;
        return true;
    } else {
        button.classList.add('css-1n8tzw1');
        button.classList.remove('css-7teszh');
        button.style.stroke = isHovered ? hoverColor : baseColor;
        return false;
    }
}

async function parseListing(listingUrl) {
    try {
        const listingDoc = await fetchListing(listingUrl);

        const titleDiv = listingDoc.querySelector('[data-testid^="listing-details__listing-summary-title"]')
            || listingDoc.querySelector('[data-testid^="listing-details__summary-title"]').firstChild;
        const titleContent = titleDiv ? titleDiv.textContent : '';

        const addressDiv = listingDoc.querySelector('[data-testid="listing-details__listing-summary-address"]')
            || listingDoc.querySelector('[data-testid="listing-details__button-copy-wrapper"]').firstChild;
        const addressContent = addressDiv ? addressDiv.textContent : '';

        const layoutDivs = listingDoc.querySelectorAll('[data-testid="property-features-feature"]');
        const keys = ['Beds', 'Baths', 'Parking']
        const layout = {}
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const text = layoutDivs[i].querySelector('[data-testid="property-features-text-container"]').textContent;
            layout[key] = text.split(/\s+/)[0];
        }
        // keys: Beds, Baths, Parking

        const imagesDiv = listingDoc.querySelector('[data-testid^="listing-details__gallery-preview"]');
        const imgElements = imagesDiv ? Array.from(imagesDiv.getElementsByTagName('img')) : [];
        const images = imgElements.map(img => img.src);

        const featuresDiv = listingDoc.querySelector('[data-testid="listing-details__additional-features"]')
            || listingDoc.querySelector('[data-testid="listing-details__listing-summary-key-selling-points-list"]');
        const featureContent = featuresDiv
            ? Array.from(featuresDiv.querySelectorAll('li'))
                .map(item => item.textContent.trim())
                .join(', ')
            : '';

        const descriptionDiv = listingDoc.querySelector('[data-testid="listing-details__description"]');
        const descriptionContent = descriptionDiv
            ? Array.from(descriptionDiv.querySelectorAll('p, h3'))
                .map(item => item.textContent.trim())
                .join('\n')
            : '';

        return {
            title: titleContent,
            address: addressContent,
            layout: layout,
            images: images,
            features: featureContent,
            description: descriptionContent
        }
    } catch (e) {
        console.error('Error parsing listing', listingUrl, e);
        return '';
    }
}

async function fetchListing(listingUrl, retries = 3, delay = 1000) {
    try {
        const response = await fetch(listingUrl);
        if (!response.ok) throw new Error('HTTP error, status: ' + response.status);

        const text = await response.text()
        return parser.parseFromString(text, 'text/html');
    } catch (e) {
        if (retries <= 0) {
            throw new Error('Unable to fetch listing after multiple retries.');
        } else {
            console.error(`Attempt fetching listing failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await fetchListing(listingUrl, retries - 1, delay);
        }
    }
}

async function excludeListing(data, content) {
    const excludeKeywords = (data.excludeKeys ?? '').toLowerCase().split(/\s*,\s*/);
    if (!isStudioType) excludeKeywords.push('studio');

    const combinedContent = `${content.title}\n${content.features}\n${content.description}`.toLowerCase();

    // Search for excluded keywords
    for (const excludeKey of excludeKeywords) {
        if (excludeKey === '') continue;
        if (combinedContent.includes(excludeKey)) return true;
    }

    // Search for strata fees
    if (data.strataMax < 1000) {
        const match = strataRegex.exec(combinedContent);
        if (match) {
            const strata = parseFloat(match[0].replace(/,/g, ''));
            if (strata > data.strataMax) return true;
        }
    }

    return false;
}

async function preferListing(data, content) {
    const preferences = (data.preferences ?? []).slice();
    const otherPreferences = (data.otherPreference ?? '').toLowerCase().split(/\s*,\s*/);
    otherPreferences.forEach((preference) => preferences.push(preference));

    let preferred = 0;
    let allPreferred = preferences.length;

    const combinedContent = `${content.title}\n${content.features}\n${content.description}`.toLowerCase();

    // Search for preferences
    for (const preference of preferences) {
        if (preference === '') {
            allPreferred--;
            continue;
        }
        if (combinedContent.match(preference)) preferred++;
    }

    return preferred / allPreferred;
}

function preferColor(preferred) {
    return preferred > 0.9 ? preferredAllColor :
            preferred > 0.6 ? preferredHalfColor :
            preferred > 0.4 ? preferredSomeColor :
            preferred > 0.2 ? preferredLittleColor :
            '#fff';
}