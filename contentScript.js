/*
 * contentScript.js is injected onto any meet.google.com page. This has different logic depending on if
 * it is running in the PWA or a normal tab. The PWA portion will redirect it to the correct meeting
 * (if not currently on a meeting). The normal tab will replace the content on the original page
 * informing the user they were redirected to the PWA.
 */

/**
 * Builds the notification elements to inform the user they were redirected to the PWA.
 * @param originalMeetContents the original element that was replaced with the redirect notification
 * @param originalMeetContentsDisplay the original display style of the original element
 * @returns {HTMLDivElement} the overlay element containing the notification
 */
function buildNotificationElements(
  originalMeetContents,
  originalMeetContentsDisplay
) {
  const pageContainerOverlay = document.createElement("div");
  pageContainerOverlay.style.position = "absolute";
  pageContainerOverlay.style.top = "0";
  pageContainerOverlay.style.left = "0";
  pageContainerOverlay.style.width = "100%";
  pageContainerOverlay.style.height = "100%";
  pageContainerOverlay.style.backgroundColor = "rgba(0,0,0,.2)";
  pageContainerOverlay.style.zIndex = "9999";
  pageContainerOverlay.style.display = "flex";
  pageContainerOverlay.style.justifyContent = "center";
  pageContainerOverlay.style.alignItems = "center";

  const messageCard = document.createElement("div");
  messageCard.style.backgroundColor = "white";
  messageCard.style.padding = "2em 4em";
  messageCard.style.borderRadius = "1em";
  messageCard.style.boxShadow = "0 4px 8px rgba(0,0,0,.2)";
  messageCard.style.fontSize = "1.5em";
  messageCard.style.display = "flex";
  messageCard.style.flexDirection = "column";
  messageCard.style.alignItems = "center";
  messageCard.style.justifyContent = "center";
  messageCard.style.width = "max(50%, 400px)";

  const cardHeader = document.createElement("h1");
  cardHeader.textContent = "Opening in Google Meet PWA";

  const cardDescription = document.createElement("p");
  cardDescription.textContent =
    "You have been redirected to the Google Meet PWA by the SpeedyMeet extension. " +
    "This tab will be closed automatically once the PWA joins the meeting.";

  const useThisTabButton = document.createElement("button");
  useThisTabButton.textContent = "Use this tab instead";
  useThisTabButton.style.backgroundColor = "blue";
  useThisTabButton.style.color = "white";
  useThisTabButton.style.border = "none";
  useThisTabButton.style.padding = "10px 20px";
  useThisTabButton.style.borderRadius = ".5em";
  useThisTabButton.style.fontWeight = "600";
  useThisTabButton.style.fontSize = "16px";
  useThisTabButton.style.cursor = "pointer";

  useThisTabButton.onclick = function () {
    originalMeetContents.style.display = originalMeetContentsDisplay;
    pageContainerOverlay.remove();
  };

  pageContainerOverlay.appendChild(messageCard);
  messageCard.appendChild(cardHeader);
  messageCard.appendChild(cardDescription);
  messageCard.appendChild(useThisTabButton);

  return pageContainerOverlay;
}

(() => {
  if (isPwa()) {
    chrome.storage.onChanged.addListener(function (changes) {
      if (
        changes['queryParams'] &&
        changes['queryParams'].newValue !== '__gmInitialState'
      ) {
        let onCall = !!window.location.pathname.match(
          /[a-z0-9]{3,5}-[a-z0-9]{3,5}-[a-z0-9]{3,5}/i
        );

        if (
          onCall &&
          !confirm(
            "A new meeting is starting, do you want to switch to the new meeting?"
          )
        ) {
          // reset params
          chrome.storage.local.set({
            originatingTabId: '',
            queryParams: '__gmInitialState',
            source: '',
          });
          return;
        }

        const qp = changes['queryParams'].newValue;
        const newQueryParams = qp.includes('?')
        ? qp.includes('authuser=')
            ? qp
          : qp + '&authuser=0'
        : qp + '?authuser=0';

        const currentHref = window.location.href;
        const newHref = 'https://meet.google.com/' + newQueryParams;
        if (currentHref !== newHref) {
          window.location.href = 'https://meet.google.com/' + newQueryParams;
        }

        // close original tab
        chrome.storage.local.set({
          googleMeetOpenedUrl: new Date().toISOString(),
        });
      }
    });
  } else {
    // Normal tab, add listener to replace UI with
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes["originatingTabId"] && changes["originatingTabId"].newValue) {
        // could improve this. it only properly replaces if you navigated to a meet.google.com/some-slug
        // it does not know how to replace the landing page.
        const originalMeetContents = document.body.childNodes[1];
        originalMeetContents.style.display = "none";

        const pageContainerOverlay = buildNotificationElements(
          originalMeetContents,
          'block'
        );

        document.body.appendChild(pageContainerOverlay);
      }
    });
  }
})();

function isPwa() {
  return ['fullscreen', 'standalone', 'minimal-ui'].some(
    (displayMode) =>
      window.matchMedia('(display-mode: ' + displayMode + ')').matches
  );
}
