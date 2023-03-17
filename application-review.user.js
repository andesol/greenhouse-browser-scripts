// ==UserScript==
// @name         Greenhouse Application Review
// @namespace    https://canonical.com/
// @version      0.4.0
// @author       Canonical's workplace engineering team
// @description  Add shortcut buttons to application review page
// @homepage     https://github.com/canonical/greenhouse-browser-scripts
// @homepageURL  https://github.com/canonical/greenhouse-browser-scripts
// @icon         https://icons.duckduckgo.com/ip3/greenhouse.io.ico
// @updateURL    https://raw.githubusercontent.com/canonical/greenhouse-browser-scripts/main/application-review.user.js
// @downloadURL  https://raw.githubusercontent.com/canonical/greenhouse-browser-scripts/main/application-review.user.js
// @supportURL   https://github.com/canonical/greenhouse-browser-scripts/issues

// @match        https://canonical.greenhouse.io/applications/review/app_review*
// ==/UserScript==

// reload the page if requested by previous operations
if (location.href.includes("canonical-reload=true"))
    window.location = window.location.href.replace(/&canonical-reload=.+/, "");

checkForNotification();
initActionsDropdown();

function initActionsDropdown() {
    const rejectBtnEl = document.querySelector("*[data-provides='reject']");
    const actionsBarEl = rejectBtnEl.parentNode;

    actionsBarEl.insertAdjacentHTML(
        "afterbegin",
        /* html */
        `
        <div class="rejection">
          <button data-name="Lacking skills" data-reason="Lacks domain experience" class="rejection__button">
            Lacking skills
          </button>
          <button data-name="Academics" data-reason="Academic track record" class="rejection__button">
            Lacking Academics
          </button>
          <button data-name="Illegible language" data-note="Submission not in English" data-reason="Other (add notes below)" class="rejection__button">
            Illegible language
          </button>
          <button data-name="Wrong timezone" data-reason="Wrong timezone" class="rejection__button">
            Wrong timezone
          </button>
        </div>
        <style>
        .rejection {
           display: flex;
        }

        .rejection__button {
            height: 36px;
            background-color: #d8372a;
            color: white;
            font-weight: 600;
            border: none;
            padding: 0 1rem;
            border-radius: 3px;
            font-size: 0.75rem;
            margin: 0;
            margin-right: 0.5rem;
            cursor: pointer;
            align-content: center;
            display: flex;
            align-items: center;
       }

       .rejection__button:hover {
           background-color: #af2b20;
       }

       .rejection__button[aria-expanded=true] {
           background-color: #af2b20;
       }

       .rejection__button:disabled, .rejection__button:disabled:hover {
           background-color: #767676;
           cursor: not-allowed;
       }

       .spinner {
           margin-right: 0.5rem;
           background: #767676;
           width: 0.75rem;
           height: 0.75rem;
           border: 3px solid white;
           border-top: 3px solid #767676;
           border-radius: 50%;
           transition-property: transform;
           animation-name: rotate;
           animation-duration: 1.2s;
           animation-iteration-count: infinite;
           animation-timing-function: linear;
        }

        @-webkit-keyframes rotate {
            from {ransform: rotate(0deg);}
            to {transform: rotate(360deg);}
        }
        </style>
    `
    );

    const rejectionButtons = document.querySelectorAll(
        ".rejection__button[data-reason]"
    );
    rejectionButtons.forEach((rejectionButton) => {
        rejectionButton.addEventListener("click", async (e) => {
            try {
                const element = e.target;
                const name = element.dataset.name;
                const note = element.dataset.note ? element.dataset.note : null;
                const reason = element.dataset.reason;
                addSpinner(element);
                setLoading();
                await reject({
                    name: name,
                    reason: reason,
                    note: note,
                    startNewProcessAfterRejection: false,
                    sendEmail: true,
                });
            } catch (error) {
                pushNotification(error.message, true);
                setEnabled();
                checkForNotification();
            }
        });
    });
}

/**
 * fill the rejection form and submit
 * @private
 * @param {object} rejection
 * @param {string} rejection.reason the rejection reason
 * @param {boolean} rejection.sendEmail indicates whether we should try to send an email
 * @param {string|null} rejection.note the rejection node
 * @param {boolean} rejection.startNewProcessAfterRejection whether this option needs to be enable on rejection
 *
 */
async function reject({
    reason,
    sendEmail,
    note = null,
    startNewProcessAfterRejection = false,
}) {
    const mainEl = document.querySelector(
        "#app_review_wrapper [data-react-props]"
    );
    if (!mainEl)
        throw new Error("[Canonical GH] Failed to get the application context");
    const context = JSON.parse(mainEl.getAttribute("data-react-props"));
    const applicationId = context.current_application?.id;
    const personId = context.current_application?.person_id;
    const stageId = context.current_application?.current_stage?.app_stage_id;
    if (!(applicationId && stageId && personId))
        throw new Error(
            "[Canonical GH] Missing data in the application context"
        );
    const formData = await getRejectionFormData(applicationId);

    const rejectionReasonId = formData.rejection_options
        .find(({ label }) => label.match(/we rejected them/i))
        ?.options.find(
            ({ label }) =>
                label === reason || label.match(new RegExp(reason, "i"))
        )?.value;
    if (!rejectionReasonId)
        throw new Error("[Canonical GH] Rejection reason not found: " + reason);
    sendEmail = sendEmail && formData.can_email;
    let payload = {
        from_review_tool: true,
        from_stage_id: stageId,
        action_type: "reject",
        reject_from_all: false,
        create_prospect_from_rejection: startNewProcessAfterRejection,
        on_other_active_hiring_plans: false,
        rejection_reason: rejectionReasonId,
        send_rejection_email: sendEmail ? true : null,
        rejection_details: {},
    };
    if (sendEmail) {
        const defaultEmailTemplateId = formData.email_template_options.find(
            ({ label }) =>
                label.match(new RegExp("Default Candidate Rejection", "i"))
        )?.value;
        if (!defaultEmailTemplateId)
            throw new Error(
                "[Canonical GH] Default email template not found: " + reason
            );
        const emailTemplate = await getEmailTemplate(
            personId,
            applicationId,
            defaultEmailTemplateId
        );

        payload = {
            ...payload,
            rejection_from: emailTemplate.from,
            rejection_to: formData.to_options[0].value,
            rejection_cc: emailTemplate.cc.join(","),
            rejection_cc_recruiter: emailTemplate.cc_recruiter,
            rejection_cc_coordinator: emailTemplate.cc_coordinator,
            rejection_subject: emailTemplate.subject,
            rejection_html_body: emailTemplate.html_body,
            rejection_send_at: formData.when_email_options[0].value,
            custom_attachment_url: "",
            custom_attachment_filename: "",
            rejection_email_template: defaultEmailTemplateId,
        };
    }

    if (note) payload.rejection_note = note;

    const response = await fetch(
        `https://canonical.greenhouse.io/applications/review/app_review/${applicationId}/reject`,
        {
            headers: {
                accept: "application/json",
                "content-type": "application/json;charset=UTF-8",
                "x-csrf-token": getCSRFToken(),
            },
            body: JSON.stringify(payload),
            credentials: "include",
            method: "POST",
            mode: "cors",
            referrer: location.href,
            referrerPolicy: "strict-origin-when-cross-origin",
        }
    );
    if (!response.ok)
        throw new Error("[Canonical GH] Invalid rejection payload");
    await navigateToNextApplication(
        context.applications.filter(
            (application) => application.id !== applicationId
        )
    );
}

/**
 * @typedef {Object} RejectionFormData
 * @property {boolean} can_email
 * @property {boolean} source_display
 * @property {boolean} referred_by_agency
 * @property {number} num_other_hiring_plans
 * @property {boolean} can_reject_from_all
 * @property {boolean} new_coordinator_required
 * @property {boolean} new_coordinator_options
 * @property {boolean} new_recruiter_required
 * @property {boolean} new_recruiter_options
 * @property {boolean} can_create_prospect
 * @property {boolean} can_create_new_reason
 * @property {boolean} rejection_reason_required
 * @property {string} cc_options_path
 *
 * @property {{
 * label: string,
 * value: string,
 * disabled: boolean,
 * options: { label: string, value: number, type: string }[]
 * }[]} rejection_options
 *
 * @property {{
 * label: string,
 * value: number,
 * type: string
 * }[]} custom_rejection_type_options
 *
 * @property {{
 * label: string,
 * value: number,
 * office_ids: number[],
 * default: boolean,
 * url: string,
 * anywhere: boolean
 * }[]} email_template_options
 *
 * @property {{
 * label: string,
 * value: string
 * }[]} from_options
 *
 * @property {{
 * label: string,
 * value: string
 * }[]} to_options
 *
 *
 * @property {{
 * label: string,
 * value: string
 * }[]} when_email_options
 *
 * @property {{
 * label: string
 * value: number
 * }[]} time_options
 *
 * @property {Object[]} custom_fields
 *
 * @property {string[]} currencies
 */
/**
 * get the rejection details for the current application
 * @param {number} applicationId current application's id
 * @returns {Promise<RejectionFormData>}
 */
function getRejectionFormData(applicationId) {
    return httpGetJson(
        `https://canonical.greenhouse.io/applications/review/app_review/${applicationId}/reject_modal`,
        "[Canonical GH] Failed to get application rejection form data"
    );
}

/**
 *
 * @returns @typedef {Object} EmailTemplate
 * @property {string} status
 * @property {string} subject
 * @property {string} body
 * @property {string} html_body
 * @property {string} from
 * @property {string[]} cc
 * @property {boolean} cc_recruiter
 * @property {boolean} cc_coordinator
 * @property {Object[]} attachment
 */

/**
 * get the rejection pre filled email details
 * @param {number} personId applicant
 * @param {number} applicationId application to reject
 * @param {number} emailTemplateId the email template
 * @returns {Promise<EmailTemplate>}
 */
async function getEmailTemplate(personId, applicationId, emailTemplateId) {
    const emailTemplate = await httpGetJson(
        `https://canonical.greenhouse.io/person/${personId}/email_templates/${emailTemplateId}?application_id=${applicationId}`,
        "[Canonical GH] Failed to get application rejection email template"
    );
    if (!emailTemplate)
        throw new Error(
            "[Canonical GH] Failed to retrieve email template with id " +
                emailTemplateId
        );
    return emailTemplate;
}

async function httpGetJson(url, errorMsg) {
    try {
        const response = await fetch(url, {
            headers: {
                accept: "application/json",
                "x-csrf-token": getCSRFToken(),
            },
            referrer: location.href,
            referrerPolicy: "strict-origin-when-cross-origin",
            body: null,
            method: "GET",
            mode: "cors",
            credentials: "include",
        });
        if (!response.ok) throw new Error();
        return await response.json();
    } catch {
        throw new Error(errorMsg);
    }
}

async function navigateToNextApplication(applications) {
    await sleep(1000);

    const nextApplicationEl = document.querySelector("[data-provides*=skip]");
    if (nextApplicationEl && applications.length) {
        nextApplicationEl.click();
        removeNotification();
        pushNotification("Application rejected successfully");
        // the restart option indicates that once the reload page is done
        // and the script is loaded, do another reload to update the cached data
        window.location =
            window.location.href.replace(/&canonical-reload=.+/, "") +
            "&canonical-reload=true";
    } else {
        pushNotification("No more applications to review 🎉");
        window.location = window.location.href;
    }
}

/*--------------------------------------------------*/
/*                    Utilities                     */
/*--------------------------------------------------*/
function escapeId(name) {
    return "canonical-" + name.replace(/(-|\/|,|\s)/gi, "-");
}
function getCSRFToken() {
    return document
        .querySelector("meta[name=csrf-token]")
        .getAttribute("content");
}

function sleep(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}

/*--------------------------------------------------*/
/*         Vanilla framework CSS utilities          */
/*--------------------------------------------------*/

function addSpinner(el) {
    el.insertAdjacentHTML(
        "afterbegin",
        `
    <div class="spinner"></div>
    `
    );
    el.setAttribute("disabled", "true");
}

function setLoading() {
    const quickRejectionButtons = document.querySelectorAll(
        ".rejection__button[data-reason]"
    );
    quickRejectionButtons.forEach((quickRejectionButton) => {
        quickRejectionButton.setAttribute("disabled", "true");
    });
}

function setEnabled() {
    const quickRejectionButtons = document.querySelectorAll(
        ".rejection__button[data-reason]"
    );
    quickRejectionButtons.forEach((quickRejectionButton) => {
        quickRejectionButton.getElementsByClassName("spinner")[0]?.remove();
        quickRejectionButton.setAttribute("disabled", "false");
    });
}

function pushNotification(message, error = false) {
    localStorage.setItem(
        "canonical.notification",
        JSON.stringify({
            message: message.replace("[Canonical GH] ", ""),
            error,
        })
    );
}

function checkForNotification() {
    const notification = localStorage.getItem("canonical.notification");
    if (!notification) return;

    const { message, error } = JSON.parse(notification);
    document.body.insertAdjacentHTML(
        "afterbegin",
        /* HTML */
        `
            <div
                class="notification--${error ? "negative" : "positive"}"
                id="notification"
            >
                <div class="notification__content">
                    <h5 class="notification__title">${message}</h5>
                    <p class="notification__message">Canonical automation</p>
                    <button
                        class="notification__close"
                        aria-controls="notification"
                    >
                        X
                    </button>
                </div>
            </div>
            <style>
                #notification {
                    z-index: 9999;
                    max-width: 20rem;
                    padding: 0.5rem 3rem;
                    margin: 1rem;
                    position: fixed;
                    right: 0;
                    top: 0;
                    background: white;
                    border-left: 0.5rem solid #008561;
                    border-radius: 2px;
                }

                .notification__close {
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    position: absolute;
                    right: 0.5rem;
                    top: 0.5rem;
                    font-size: 1rem;
                }

                .u-hide {
                    display: none;
                }
            </style>
        `
    );
    // Set up all notification close buttons.
    var closeButtons = document.querySelectorAll(".notification__close");

    for (var i = 0, l = closeButtons.length; i < l; i++) {
        setupCloseButton(closeButtons[i]);
    }
    // Auto close after 5 seconds
    setTimeout(() => {
        closeButtons.forEach((button) => button.click());
    }, 5 * 1000);
}

/* Dismissible notification js part */
/**
 * Attaches event listener for hide notification on close button click.
 * @param {HTMLElement} closeButton The notification close button element.
 */
function setupCloseButton(closeButton) {
    closeButton.addEventListener("click", function (event) {
        var target = event.target.getAttribute("aria-controls");
        var notification = document.getElementById(target);

        if (notification) {
            notification.classList.add("u-hide");
        }

        removeNotification();
    });
}

function removeNotification() {
    localStorage.removeItem("canonical.notification");
}
