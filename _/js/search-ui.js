(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports)
    : typeof define === 'function' && define.amd ? define(['exports'], factory)
      : (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.antoraSearch = {}))
})(this, function (exports) {
  'use strict'

  /**
   * Splitting the text by the given positions.
   * The text within the positions getting the type "mark", all other text gets the type "text".
   * @param {string} text
   * @param {Object[]} positions
   * @param {number} positions.start
   * @param {number} positions.length
   * @param {number} snippetLength Maximum text length for text in the result.
   * @returns {[{text: string, type: string}]}
   */
  function buildHighlightedText (text, positions, snippetLength) {
    const textLength = text.length
    const validPositions = positions
      .filter((position) => position.length > 0 && position.start + position.length <= textLength)

    if (validPositions.length === 0) {
      return [
        {
          type: 'text',
          text: text.slice(0, snippetLength >= textLength ? textLength : snippetLength) + (snippetLength < textLength ? '...' : ''),
        },
      ]
    }

    const orderedPositions = validPositions.sort((p1, p2) => p1.start - p2.start)
    const range = {
      start: 0,
      end: textLength,
    }
    const firstPosition = orderedPositions[0]
    if (snippetLength && text.length > snippetLength) {
      const firstPositionStart = firstPosition.start
      const firstPositionLength = firstPosition.length
      const firstPositionEnd = firstPositionStart + firstPositionLength

      range.start = firstPositionStart - snippetLength < 0 ? 0 : firstPositionStart - snippetLength
      range.end = firstPositionEnd + snippetLength > textLength ? textLength : firstPositionEnd + snippetLength
    }
    const nodes = []
    if (firstPosition.start > 0) {
      nodes.push({
        type: 'text',
        text: (range.start > 0 ? '...' : '') + text.slice(range.start, firstPosition.start),
      })
    }
    let lastEndPosition = 0
    const positionsWithinRange = orderedPositions
      .filter((position) => position.start >= range.start && position.start + position.length <= range.end)

    for (const position of positionsWithinRange) {
      const start = position.start
      const length = position.length
      const end = start + length
      if (lastEndPosition > 0) {
        // create text Node from the last end position to the start of the current position
        nodes.push({
          type: 'text',
          text: text.slice(lastEndPosition, start),
        })
      }
      nodes.push({
        type: 'mark',
        text: text.slice(start, end),
      })
      lastEndPosition = end
    }
    if (lastEndPosition < range.end) {
      nodes.push({
        type: 'text',
        text: text.slice(lastEndPosition, range.end) + (range.end < textLength ? '...' : ''),
      })
    }

    return nodes
  }

  /**
   * Taken and adapted from: https://github.com/olivernn/lunr.js/blob/aa5a878f62a6bba1e8e5b95714899e17e8150b38/lib/tokenizer.js#L24-L67
   * @param lunr
   * @param text
   * @param term
   * @return {{start: number, length: number}}
   */
  function findTermPosition (lunr, term, text) {
    const str = text.toLowerCase()
    // const len = str.length

    // experiment with avoiding regex
    const index = str.indexOf(term)
    const len = str.substr(index).match(/^[^.,\s]*/)[0].length

    if (index === -1) {
      // Not found
      return {
        start: 0,
        length: 0,
      }
    } else {
      return {
        start: index,
        length: len,
      }
    }
  }

  /* global CustomEvent, globalThis */

  const config = document.getElementById('search-ui-script').dataset
  const snippetLengthBase = parseInt(config.snippetLength || 100, 10)
  let snippetLength = snippetLengthBase
  const siteRootPath = config.siteRootPath || ''
  appendStylesheet(config.stylesheet)
  const searchInput = document.getElementById('search-input')
  const searchResultContainer = document.createElement('div')
  searchResultContainer.classList.add('search-result-dropdown-menu')
  searchResultContainer.onkeydown = (event) => {
    if (event.key === 'Escape' || event.key === 'Esc') {
      return clearSearchResults(true)
    }
  }
  searchInput.parentNode.appendChild(searchResultContainer)
  const searchFilters = document.createElement('div')
  searchFilters.id = 'search-filters'
  searchFilters.classList.add('hidden')
  searchResultContainer.appendChild(searchFilters)
  let conversationWithBob = {}

  function appendStylesheet (href) {
    if (!href) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }

  function highlightPageTitle (title, terms) {
    const positions = getTermPosition(title, terms)
    return buildHighlightedText(title, positions, snippetLength)
  }

  function highlightSectionTitle (sectionTitle, terms) {
    if (sectionTitle) {
      const text = sectionTitle.text
      const positions = getTermPosition(text, terms)
      return buildHighlightedText(text, positions, snippetLength)
    }
    return []
  }

  function highlightKeyword (doc, terms) {
    const keyword = doc.keyword
    if (keyword) {
      const positions = getTermPosition(keyword, terms)
      return buildHighlightedText(keyword, positions, snippetLength)
    }
    return []
  }

  function highlightText (doc, terms) {
    const text = doc.text
    const positions = getTermPosition(text, terms)
    return buildHighlightedText(text, positions, snippetLength)
  }

  function getTermPosition (text, terms) {
    const positions = terms
      .map((term) => findTermPosition(globalThis.lunr, term, text))
      .filter((position) => position.length > 0)
      .sort((p1, p2) => p1.start - p2.start)

    if (positions.length === 0) {
      return []
    }
    return positions
  }

  function highlightHit (searchMetadata, sectionTitle, doc) {
    const terms = {}
    for (const term in searchMetadata) {
      const fields = searchMetadata[term]
      for (const field in fields) {
        terms[field] = [...(terms[field] || []), term]
      }
    }
    return {
      pageTitleNodes: highlightPageTitle(doc.title, terms.title || []),
      sectionTitleNodes: highlightSectionTitle(sectionTitle, terms.title || []),
      pageContentNodes: highlightText(doc, terms.text || []),
      pageKeywordNodes: highlightKeyword(doc, terms.keyword || []),
    }
  }

  function createSearchResult (index, store, text, result, searchResultDataset) {
    let currentComponent
    if (result.length > 7) {
      // add hidden title
      const searchTitle = document.createElement('h2')
      searchTitle.id = 'search-title'
      searchTitle.innerHTML = `Your search for "${text}" returned ${result.length} result${result.length == 1 ? '' : 's'}.`
      searchResultDataset.appendChild(searchTitle)
      // add note
      const componentCount = countComponents(result, store)
      const searchMore = document.createElement('p')
      searchMore.id = 'search-more'
      searchMore.innerHTML = `Explore all ${result.length} result${result.length == 1 ? '' : 's'}`
        + ` in ${componentCount} book${componentCount == 1 ? '' : 's'} for <b>${text}</b>. 🔍`
      searchMore.onkeydown = searchMore.onclick = (event) => {
        if (event.key !== undefined && event.key !== "Enter") { return }
        // reload but with more snippet length
        snippetLength *= 5
        searchIndex (index, store, text)
        // maximize
        const navBarItem = searchResultContainer.parentElement.parentElement
        navBarItem.classList.toggle("max")
        searchInput.focus()
      }
      // make the fake link keyboard-navigable
      searchMore.setAttribute("tabindex", "0")
      searchResultDataset.appendChild(searchMore)
    }
    var position = 0;
    result.forEach((item) => {
      const ids = item.ref.split('-')
      const docId = ids[0]
      const doc = store.documents[docId]
      let sectionTitle
      if (ids.length > 1) {
        const titleId = ids[1]
        sectionTitle = doc.titles.filter(function (item) {
          return String(item.id) === titleId
        })[0]
      }
      const metadata = item.matchData.metadata
      const highlightingResult = highlightHit(metadata, sectionTitle, doc)
      const componentVersion = store.componentVersions[`${doc.component}/${doc.version}`]
      if (componentVersion !== undefined && currentComponent !== componentVersion) {
        const searchResultComponentHeader = document.createElement('div')
        searchResultComponentHeader.classList.add('search-result-component-header')
        if (position >= 7)
          searchResultComponentHeader.classList.add("hidden")
        const { title, displayVersion } = componentVersion
        const componentVersionText = `${title}${doc.version && displayVersion ? ` ${displayVersion}` : ''}`
        searchResultComponentHeader.appendChild(document.createTextNode(componentVersionText))
        searchResultDataset.appendChild(searchResultComponentHeader)
        currentComponent = componentVersion
      }
      searchResultDataset.appendChild(createSearchResultItem(doc, sectionTitle, item, highlightingResult, position++))
    })
  }

  function countComponents(result, store) {
    const components = {}
    result.forEach(function (item) {
      const ids = item.ref.split('-')
      const docId = ids[0]
      const doc = store.documents[docId]
      components[doc.component] = {}
    })
    return Object.keys(components).length
  }

  function createSearchResultItem (doc, sectionTitle, item, highlightingResult, position) {
    const documentTitle = document.createElement('div')
    documentTitle.classList.add('search-result-document-title')
    highlightingResult.pageTitleNodes.forEach(function (node) {
      let element
      if (node.type === 'text') {
        element = document.createTextNode(node.text)
      } else {
        element = document.createElement('span')
        element.classList.add('search-result-highlight')
        element.innerText = node.text
      }
      documentTitle.appendChild(element)
    })
    const documentHit = document.createElement('div')
    documentHit.classList.add('search-result-document-hit')
    const documentHitLink = document.createElement('a')
    documentHitLink.href = siteRootPath + doc.url + (sectionTitle ? '#' + sectionTitle.hash : '')
    documentHit.appendChild(documentHitLink)
    if (highlightingResult.sectionTitleNodes.length > 0) {
      const documentSectionTitle = document.createElement('div')
      documentSectionTitle.classList.add('search-result-section-title')
      documentHitLink.appendChild(documentSectionTitle)
      highlightingResult.sectionTitleNodes.forEach((node) => createHighlightedText(node, documentSectionTitle))
    }
    highlightingResult.pageContentNodes.forEach((node) => createHighlightedText(node, documentHitLink))

    // only show keyword when we got a hit on them
    if (doc.keyword && highlightingResult.pageKeywordNodes.length > 1) {
      const documentKeywords = document.createElement('div')
      documentKeywords.classList.add('search-result-keywords')
      const documentKeywordsFieldLabel = document.createElement('span')
      documentKeywordsFieldLabel.classList.add('search-result-keywords-field-label')
      documentKeywordsFieldLabel.innerText = 'keywords: '
      const documentKeywordsList = document.createElement('span')
      documentKeywordsList.classList.add('search-result-keywords-list')
      highlightingResult.pageKeywordNodes.forEach((node) => createHighlightedText(node, documentKeywordsList))
      documentKeywords.appendChild(documentKeywordsFieldLabel)
      documentKeywords.appendChild(documentKeywordsList)
      documentHitLink.appendChild(documentKeywords)
    }
    const searchResultItem = document.createElement('div')
    searchResultItem.classList.add('search-result-item')
    searchResultItem.appendChild(documentTitle)
    searchResultItem.appendChild(documentHit)
    if (position >= 7)
      searchResultItem.classList.add("hidden")
    searchResultItem.addEventListener('mousedown', function (e) {
      e.preventDefault()
    })
    return searchResultItem
  }

  /**
   * Creates an element from a highlightingResultNode and add it to the targetNode.
   * @param {Object} highlightingResultNode
   * @param {String} highlightingResultNode.type - type of the node
   * @param {String} highlightingResultNode.text
   * @param {Node} targetNode
   */
  function createHighlightedText (highlightingResultNode, targetNode) {
    let element
    if (highlightingResultNode.type === 'text') {
      element = document.createTextNode(highlightingResultNode.text)
    } else {
      element = document.createElement('span')
      element.classList.add('search-result-highlight')
      element.innerText = highlightingResultNode.text
    }
    targetNode.appendChild(element)
  }

  function createNoResult (text) {
    const searchResultItem = document.createElement('div')
    searchResultItem.classList.add('search-result-item')
    const documentHit = document.createElement('div')
    documentHit.classList.add('search-result-document-hit')
    const message = document.createElement('strong')
    message.innerText = 'No results found for query "' + text + '"'
    documentHit.appendChild(message)
    searchResultItem.appendChild(documentHit)
    return searchResultItem
  }

  function clearSearchResults (reset) {
    if (reset === true) searchInput.value = ''
    for (const c of searchResultContainer.children) {
      if (c === searchFilters) {
        c.classList.add('hidden')
      } else {
        c.remove()
      }
    }
    const navBarItem = searchResultContainer.parentElement.parentElement
    navBarItem.classList.remove("max")
  }

  function filter (result, documents) {
    const componentFilters = []
    const versionFilters = []
    const checkboxes = document.querySelectorAll('#search-filters input[type="checkbox"]')
    checkboxes.forEach((cb) => {
      if (cb.checked && cb.dataset.facetFilter) {
        if (cb.dataset.component) componentFilters.push(cb.dataset.facetFilter.split(':'))
        else if (cb.dataset.version) versionFilters.push(cb.dataset.facetFilter.split(':'))
      }
    })
    if (versionFilters.length > 0 || componentFilters.length > 0) {
      // filter the results
      return result.filter((item) => {
        const ids = item.ref.split('-')
        const docId = ids[0]
        const doc = documents[docId]
        // for each filter group: true if empty or at least one of the filters matches
        const versionMatch = versionFilters.length == 0 || checkFilters(versionFilters, doc)
        const componentMatch = componentFilters.length == 0 || checkFilters(componentFilters, doc)
        return versionMatch && componentMatch
      })
    }
    return result
  }

  function checkFilters (filters, doc) {
    for (const filter of filters) {
      const [field, value] = filter
      if (field in doc && doc[field] == value) {
        return true
      }
    }
    return false
  }

  function search (index, documents, queryString) {
    // execute an exact match search
    let query
    let result = filter(
      index.query(function (lunrQuery) {
        const parser = new globalThis.lunr.QueryParser(queryString, lunrQuery)
        parser.parse()
        query = lunrQuery
      }),
      documents
    )
    if (result.length > 0) {
      return result
    }
    // no result, use a begins with search
    result = filter(
      index.query(function (lunrQuery) {
        lunrQuery.clauses = query.clauses.map((clause) => {
          if (clause.presence !== globalThis.lunr.Query.presence.PROHIBITED) {
            clause.term = clause.term + '*'
            clause.wildcard = globalThis.lunr.Query.wildcard.TRAILING
            clause.usePipeline = false
          }
          return clause
        })
      }),
      documents
    )
    if (result.length > 0) {
      return result
    }
    // no result, use a contains search
    result = filter(
      index.query(function (lunrQuery) {
        lunrQuery.clauses = query.clauses.map((clause) => {
          if (clause.presence !== globalThis.lunr.Query.presence.PROHIBITED) {
            clause.term = '*' + clause.term + '*'
            clause.wildcard = globalThis.lunr.Query.wildcard.LEADING | globalThis.lunr.Query.wildcard.TRAILING
            clause.usePipeline = false
          }
          return clause
        })
      }),
      documents
    )
    return result
  }

  function translationsFor (text) {
    if (glossary === undefined && texts === undefined || text == "") {
      return
    }
    const translations = []
    // All comparisons are made without punctuation and diacritics.
    text = text.replace(/[^\p{L}\s]/gu,"").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    // first the glossary
    let english = "en-us"
    const seen = []
    glossary.forEach((item) => {
      for (const entry of Object.entries(item)) {
        // if there are too many hits, abort
        if (translations.length >= 3) return
        // If the entry is not the English entry,
        // and an English entry exists,
        // and the text is a substring of the translation (so the user typed a German/French/Italian text and it was found),
        // and the value is not the same as the English text (skip those),
        // keep it.
        const [key, val] = entry
        const str = val.replace(/[^\p{L}\s]/gu,"").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
        const en = item[english].replace(/[^\p{L}\s]/gu,"").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
        if (key != english &&
            item[english] != "" &&
            str.includes(text) &&
            val != item[english] &&
            !seen.includes(en)) {
          translations.push([val, item[english]])
          seen.push(en)
        }
      }
    })
    // then the texts
    english = "en"
    texts.forEach((item) => {
      for (const entry of Object.entries(item)) {
        // if there are too many hits, abort
        if (translations.length >= 3) return
        // If the entry is not the English entry,
        // and an English entry exists,
        // and the text is a substring of the translation (so the user typed a German/French/Italian text and it was found),
        // and the value is not the same as the English text (skip those),
        // keep it.
        const [key, val] = entry
        const str = val.replace(/[^\p{L}\s]/gu,"").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
        const en = item[english].replace(/[^\p{L}\s]/gu,"").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
        if (key != english &&
            item[english] != "" &&
            str.includes(text) &&
            val != item[english] &&
            !seen.includes(en)) {
          translations.push([val, item[english]])
          seen.push(en)
        }
      }
    })
    // sort translations
    const locales = ["en", "de", "fr", "it"]
    const options = { usage: "search", sensitivity: "base", ignorePunctuation: true, }
    return translations.sort((a, b) => a[1].localeCompare(b[1], locales, options))
  }

  function createGlossaryResult (index, store, text, translations, searchResultDataset) {
    if (translations.length == 0) return
    const searchResultComponentHeader = document.createElement('div')
    searchResultComponentHeader.classList.add('search-result-component-header')
    searchResultComponentHeader.innerHTML = "Glossary"
    searchResultDataset.appendChild(searchResultComponentHeader)
    translations.forEach((translation) => {
      searchResultDataset.appendChild(createGlossaryItem(index, store, text, translation))
    })
  }

  function createGlossaryItem (index, store, text, translation) {
    const [found, english] = translation
    const documentTitle = document.createElement('div')
    documentTitle.classList.add('search-result-document-title')
    documentTitle.innerHTML = found
    const documentHit = document.createElement('div')
    documentHit.classList.add('search-result-document-hit')
    const documentHitLink = document.createElement('a')
    documentHitLink.setAttribute("href", "") // cursor: pointer needs this
    const element = document.createElement('span')
    element.classList.add('search-result-highlight')
    element.innerText = english
    documentHitLink.onclick = () => {
      searchInput.value = english
      searchIndex(index, store, english)
    }
    documentHitLink.appendChild(element)
    documentHit.appendChild(documentHitLink)
    const searchResultItem = document.createElement('div')
    searchResultItem.classList.add('search-result-item')
    searchResultItem.appendChild(documentTitle)
    searchResultItem.appendChild(documentHit)
    return searchResultItem
  }

  function searchIndex (index, store, text) {
    clearSearchResults(false)
    if (text.trim() === '') {
      return
    }
    searchFilters.classList.remove('hidden')
    const result = search(index, store.documents, text)
    const searchResultDataset = document.createElement('div')
    // add AI magic dust
    const ai = document.createElement('textarea')
    ai.id="ai-ui"
    ai.placeholder="Ask a question"
    ai.innerHTML = text
    ai.setAttribute("tabindex", "0")
    searchResultDataset.appendChild(ai)
    const btn = document.createElement('button')
    btn.innerHTML = 'Ask AI 🧠'
    btn.onclick = ask_ai;
    searchResultDataset.appendChild(btn)
    // add actual results
    searchResultDataset.classList.add('search-result-dataset')
    searchResultContainer.appendChild(searchResultDataset)
    createGlossaryResult(index, store, text, translationsFor(text), searchResultDataset)
    if (result.length > 0) {
      createSearchResult(index, store, text, result, searchResultDataset)
    } else {
      searchResultDataset.appendChild(createNoResult(text))
    }
  }

  function confineEvent (e) {
    e.stopPropagation()
  }

  function debounce (func, wait, immediate) {
    let timeout
    return function () {
      const context = this
      const args = arguments
      const later = function () {
        timeout = null
        if (!immediate) func.apply(context, args)
      }
      const callNow = immediate && !timeout
      clearTimeout(timeout)
      timeout = setTimeout(later, wait)
      if (callNow) func.apply(context, args)
    }
  }

  function enableSearchInput (enabled) {
    // if (facetFilterInput) {
    //   facetFilterInput.disabled = !enabled;
    // }
    searchInput.disabled = !enabled
    searchInput.title = enabled ? '' : 'Loading index...'
  }

  function isClosed () {
    return searchResultContainer.childElementCount === 0
  }

  function executeSearch (index) {
    const debug = 'URLSearchParams' in globalThis && new URLSearchParams(globalThis.location.search).has('lunr-debug')
    const query = searchInput.value
    try {
      if (!query) return clearSearchResults()
      // start with basic snippet length
      snippetLength = snippetLengthBase
      searchIndex(index.index, index.store, query)
    } catch (err) {
      clearSearchResults(false)
      searchFilters.classList.remove('hidden')
      // add error message
      const searchResultDataset = document.createElement('div')
      const msg = document.createElement('p')
      msg.id = 'error'
      if (err instanceof globalThis.lunr.QueryParseError) {
        msg.innerHTML = `The query cannot be parsed: ${err.message}`
      } else {
        msg.innerHTML = `An error occured: ${err}`
      }
      searchResultDataset.classList.add('search-result-dataset')
      searchResultContainer.appendChild(searchResultDataset)
      searchResultDataset.append(msg)
    }
  }

  function toggleFilter (e, index) {
    searchInput.focus()
    if (e.target.dataset.toggleAll) {
      const target = e.target.dataset.target
      const checkboxes = document.querySelectorAll('#search-filters input[type="checkbox"]')
      for (const cb of checkboxes) {
        if (cb.dataset.facetFilter &&
            cb.dataset.facetFilter.startsWith(target)) {
          cb.checked = e.target.checked
        }
      }
    }
    if (!isClosed()) {
      executeSearch(index)
    }
  }

  function addFiltersToggle (target) {
    const label = document.createElement('label')
    searchFilters.append(label)
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.toggleAll = true
    input.dataset.target = target
    label.append(input)
    label.append(' Select all')
  }

  function getComponentOrder (componentVersion) {
    const csv = componentVersion.asciidoc.attributes['page-component-order']
    const components = csv.split(/, */)
    // ["!main", "pink-book"] means we skip "main"
    return components.filter((s) => !s.startsWith('!'))
  }

  function addFilters (store) {
    const componentVersions = store.componentVersions
    const entries = Object.entries(componentVersions)
    let componentOrder
    const components = {}
    const versions = {}
    const container = document.getElementsByClassName('nav-container')[0]
    const currentVersion = container.dataset.version
    const currentComponent = container.dataset.component
    // collect data
    for (const [key, value] of entries) {
      if (componentOrder === undefined) {
        componentOrder = getComponentOrder(value)
      }
      components[value.name] = value
      versions[value.version] = true
    }
    // add checkboxes for the components
    const componentIntro = document.createElement('p')
    searchFilters.append(componentIntro)
    componentIntro.innerHTML = 'Books:'
    addFiltersToggle('component')
    componentOrder.forEach((name) => {
      const label = document.createElement('label')
      searchFilters.append(label)
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.dataset.facetFilter = 'component:' + name
      input.dataset.component = true
      if (name == currentComponent && name != 'main') input.checked = true
      label.append(input)
      label.append(' ' + components[name].title)
    })
    // add checkboxes for the versions
    const versionIntro = document.createElement('p')
    searchFilters.append(versionIntro)
    versionIntro.innerHTML = 'Versions:'
    addFiltersToggle('version')
    Object.keys(versions).sort(versionSort).forEach((version) => {
      const label = document.createElement('label')
      searchFilters.append(label)
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.dataset.facetFilter = 'version:' + version
      input.dataset.version = true
      if (version == currentVersion || !version) input.checked = true
      label.append(input)
      label.append(' ' + (version || 'none'))
    })
    // add link to search tips and feedback mail link
    const help = document.createElement('p')
    searchFilters.append(help)
    const url = siteRootPath + components["pink-book"].url.replace("index", "search-tips")
    help.innerHTML = `<a href=${url}>Search tips</a>` +
      ` &nbsp;&nbsp; <a href="mailto:documentation@bsi-software.com?subject=BSI%20Developer%20Books%3a%20Feedback%20on%20search%20results">Feedback</a>`
  }

  function versionSort(a, b) {
    var as = a.split('.')
    var bs = b.split('.')
    var len = Math.min(as.length, bs.length)
    for (var i = 0; i < len; i++) {
      if (as[i] === bs[i]) continue
      return +as[i] > +bs[i] ? 1 : -1
    }
    return bs.length - as.length;
  }

  function ask_ai(event) {
    if (event.key !== undefined && event.key !== "Enter") { return }
    // create history if it is missing
    const ai = document.getElementById('ai-ui')
    let history = document.getElementById('ai-history')
    if (!history) {
      history = document.createElement('div')
      history.id = "ai-history"
      ai.parentNode.insertBefore(history, ai)
    }
    // append new item to history with the text area
    const question = document.createElement('p')
    question.classList.add("chat")
    question.classList.add("question")
    question.innerHTML = ai.value + " "
    history.appendChild(question)
    // copy text to send
    const data = {
      "query": ai.value,
      "queryOptimization": false,
      "conversation": conversationWithBob
    }
    // delete textarea
    ai.value = ""
    // append new item to history for the answer
    const answer = document.createElement('div')
    answer.classList.add("bob")
    answer.classList.add("chat")
    answer.classList.add("answer")
    answer.innerHTML = "🤖💭"
    history.appendChild(answer)
    // filters
    const versions = []
    const books = []
    const checkboxes = document.querySelectorAll('#search-filters input[type="checkbox"]')
    checkboxes.forEach((cb) => {
      if (cb.checked && cb.dataset.facetFilter) {
        if (cb.dataset.component) books.push(cb.dataset.facetFilter.split(':')[1])
        else if (cb.dataset.version) versions.push(cb.dataset.facetFilter.split(':')[1])
      }
    })
    if (versions.length > 0) {
      data.versions = versions
    }
    if (books.length > 0) {
      data.books = books
    }
    const headers = new Headers();
    headers.append("Content-Type", "application/json")
    headers.append("Authorization", "Bearer A4CAA68D608CEC2F83DB5AC9A2FB9AED40504BC623FB1FC290FE703986F3D7F6")
    const init = {
      method: "POST",
      mode: "cors",
      headers: headers,
      body: JSON.stringify(data)
    }
    const request = new Request("https://aiaas.fsi.bsi.cloud/web-api/l/developerBooks/answer", init)
    fetch(request)
      .then((response) => {
        if (response.status !== 200) {
          throw new Error("AI as a service is not working as intended")
        }
        answer.innerHTML = "🤖💬 …"
        return response.json()
      })
      .then((json) => {
        answer.classList.remove("bob")
        answer.innerHTML = json.answer.replace(/^((<[^>]*>)*)/, "$2 ")
        conversationWithBob = json.conversation
      })
      .catch((error) => {
        answer.classList.remove("bob")
        const ohno = "🤖🗯️ Oh no! An error occured!"
        answer.innerHTML = ohno
        setTimeout(() => {
          if (answer.innerHTML == ohno) {
            answer.innerHTML = "… "
          }
        }, 3000) // 3s
        console.error(error)
      })
  }

  function initSearch (lunr, data) {
    const start = performance.now()
    const index = { index: lunr.Index.load(data.index), store: data.store }
    enableSearchInput(true)
    addFilters(data.store)
    searchInput.dispatchEvent(
      new CustomEvent('loadedindex', {
        detail: {
          took: performance.now() - start,
        },
      })
    )
    searchInput.addEventListener(
      'keydown',
      debounce(function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') return clearSearchResults(true)
        if (e.key !== 'Tab') executeSearch(index)
      }, 100)
    )
    searchInput.addEventListener('click', confineEvent)

    searchResultContainer.addEventListener('click', confineEvent)
    if (searchFilters) {
      searchFilters.addEventListener('click', confineEvent)
      const checkboxes = document.querySelectorAll('#search-filters input[type="checkbox"]')
      for (const cb of checkboxes) {
        cb.addEventListener('change', (e) => toggleFilter(e, index))
      }
    }
    document.documentElement.addEventListener('click', clearSearchResults)
  }

  // disable the search input until the index is loaded
  enableSearchInput(false)

  exports.initSearch = initSearch

  Object.defineProperty(exports, '__esModule', { value: true })
})
