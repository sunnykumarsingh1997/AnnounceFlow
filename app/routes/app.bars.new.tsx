import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigate, useSubmit, useNavigation, useBlocker } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Select,
  Button,
  InlineStack,
  Box,
  Divider,
  Checkbox,
  Banner,
  Modal,
  FormLayout,
  InlineGrid,
  ButtonGroup,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { createBar } from "../lib/metafields.server";
import type { BarType, BarPosition, FontSize, CTAStyle } from "../lib/types";
import { ColorPicker, FontSizeSelector, BarPreview } from "../components";

// Form data type
interface FormData {
  type: BarType;
  content: {
    text: string;
    ctaText: string;
    ctaLink: string;
  };
  style: {
    position: BarPosition;
    bgColor: string;
    textColor: string;
    fontSize: FontSize;
    buttonBgColor: string;
    buttonTextColor: string;
    progressColor: string;
    progressBgColor: string;
  };
  settings: {
    enabled: boolean;
    dismissible: boolean;
    hideWhenExpired: boolean;
    showDecline: boolean;
    showProgressBar: boolean;
  };
  extra: {
    endDatetime: string;
    expiredText: string;
  };
  // Email Capture fields
  email: {
    placeholder: string;
    buttonText: string;
    successMessage: string;
    errorMessage: string;
  };
  // Cookie Consent fields
  cookie: {
    acceptText: string;
    declineText: string;
    privacyLink: string;
    privacyText: string;
  };
  // Free Shipping fields
  shipping: {
    threshold: string;
    currency: string;
    messageTemplate: string;
    successMessage: string;
  };
}

// Validation errors type
interface FormErrors {
  text?: string;
  ctaLink?: string;
  endDatetime?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const type = formData.get("type") as BarType;
  const text = formData.get("text") as string;
  const ctaText = formData.get("ctaText") as string;
  const ctaLink = formData.get("ctaLink") as string;
  const position = formData.get("position") as BarPosition;
  const bgColor = formData.get("bgColor") as string;
  const textColor = formData.get("textColor") as string;
  const fontSize = formData.get("fontSize") as FontSize;
  const buttonBgColor = formData.get("buttonBgColor") as string;
  const buttonTextColor = formData.get("buttonTextColor") as string;
  const progressColor = formData.get("progressColor") as string;
  const progressBgColor = formData.get("progressBgColor") as string;
  const enabled = formData.get("enabled") === "true";
  const dismissible = formData.get("dismissible") === "true";

  // Countdown fields
  const endDatetime = formData.get("endDatetime") as string;
  const expiredText = formData.get("expiredText") as string;
  const hideWhenExpired = formData.get("hideWhenExpired") === "true";

  // Email Capture fields
  const emailPlaceholder = formData.get("emailPlaceholder") as string;
  const emailButtonText = formData.get("emailButtonText") as string;
  const emailSuccessMessage = formData.get("emailSuccessMessage") as string;
  const emailErrorMessage = formData.get("emailErrorMessage") as string;

  // Cookie Consent fields
  const acceptText = formData.get("acceptText") as string;
  const declineText = formData.get("declineText") as string;
  const privacyLink = formData.get("privacyLink") as string;
  const privacyText = formData.get("privacyText") as string;
  const showDecline = formData.get("showDecline") === "true";

  // Free Shipping fields
  const shippingThreshold = formData.get("shippingThreshold") as string;
  const shippingCurrency = formData.get("shippingCurrency") as string;
  const shippingMessageTemplate = formData.get("shippingMessageTemplate") as string;
  const shippingSuccessMessage = formData.get("shippingSuccessMessage") as string;
  const showProgressBar = formData.get("showProgressBar") === "true";

  // Validation
  if (type !== "cookie_consent" && type !== "free_shipping" && (!text || !text.trim())) {
    return json({ success: false, error: "Announcement text is required" }, { status: 400 });
  }

  if (type === "countdown") {
    if (!endDatetime) {
      return json({ success: false, error: "End date is required for countdown" }, { status: 400 });
    }
    if (isNaN(new Date(endDatetime).getTime())) {
      return json({ success: false, error: "Invalid end date" }, { status: 400 });
    }
  }

  if (type === "email_signup" && (!text || !text.trim())) {
    return json({ success: false, error: "Headline text is required for Email Capture" }, { status: 400 });
  }

  if (type === "cookie_consent" && (!privacyLink || !privacyLink.trim())) {
    return json({ success: false, error: "Privacy policy URL is required" }, { status: 400 });
  }

  if (type === "free_shipping") {
    const threshold = parseFloat(shippingThreshold);
    if (isNaN(threshold) || threshold <= 0) {
      return json({ success: false, error: "Shipping threshold must be a positive number" }, { status: 400 });
    }
  }

  // Check bar limit before creating
  const { checkBarLimit } = await import("../lib/metafields.server");
  const limitCheck = await checkBarLimit(session.shop, admin);

  if (!limitCheck.allowed) {
    return json(
      {
        success: false,
        error: limitCheck.reason || "Bar limit reached",
        code: "PLAN_LIMIT",
      },
      { status: 402 }
    );
  }

  // Generate a name from the text
  const displayText = text || (type === "cookie_consent" ? "Cookie Consent" : type === "free_shipping" ? "Free Shipping Bar" : "New Bar");
  const name = displayText.length > 30 ? displayText.substring(0, 30) + "..." : displayText;

  // Build content based on bar type
  const content: Record<string, unknown> = { text };

  if (type === "promotional" || type === "announcement") {
    if (ctaText) content.cta_text = ctaText;
    if (ctaLink) content.cta_link = ctaLink;
    content.cta_style = "primary" as CTAStyle;
  }

  if (type === "countdown") {
    content.end_datetime = endDatetime;
    content.expired_text = expiredText || "This offer has ended";
  }

  if (type === "email_signup") {
    content.placeholder = emailPlaceholder || "Enter your email";
    content.button_text = emailButtonText || "Subscribe";
    content.success_message = emailSuccessMessage || "Thanks! Check your inbox.";
    content.error_message = emailErrorMessage || "Please enter a valid email";
  }

  if (type === "cookie_consent") {
    content.accept_text = acceptText || "Accept";
    content.decline_text = declineText || "Decline";
    content.privacy_link = privacyLink;
    content.privacy_text = privacyText || "Learn more";
  }

  if (type === "free_shipping") {
    content.threshold = parseFloat(shippingThreshold) || 50;
    content.currency = shippingCurrency || "USD";
    content.message_template = shippingMessageTemplate || "Spend {remaining} more for FREE shipping!";
    content.success_message = shippingSuccessMessage || "You've unlocked FREE shipping!";
  }

  // Build style
  const style: Record<string, unknown> = {
    position,
    bg_color: bgColor,
    text_color: textColor,
    font_size: fontSize,
  };

  if (type === "email_signup" || type === "cookie_consent") {
    style.button_bg_color = buttonBgColor;
    style.button_text_color = buttonTextColor;
  }

  if (type === "free_shipping") {
    style.progress_color = progressColor;
    style.progress_bg_color = progressBgColor;
  }

  // Build settings
  const settings: Record<string, unknown> = {
    dismissible: type !== "cookie_consent" ? dismissible : false,
  };

  if (type === "countdown") {
    settings.hide_when_expired = hideWhenExpired;
  }

  if (type === "cookie_consent") {
    settings.show_decline = showDecline;
  }

  if (type === "free_shipping") {
    settings.show_progress_bar = showProgressBar;
  }

  const result = await createBar(admin, {
    name,
    type,
    enabled,
    content: content as any,
    style: style as any,
    settings: settings as any,
  });

  if (result.success) {
    return redirect("/app?created=true");
  }

  return json(
    { success: false, error: result.errors?.join(", ") || "Failed to create bar" },
    { status: 500 }
  );
};

// Bar type options
const barTypeOptions = [
  { label: "Promotional Announcement", value: "promotional" },
  { label: "Countdown Timer", value: "countdown" },
  { label: "Free Shipping Progress", value: "free_shipping" },
  { label: "Email Capture ★ Premium", value: "email_signup" },
  { label: "Cookie Consent", value: "cookie_consent" },
];

// URL validation helper
const isValidUrl = (url: string): boolean => {
  if (!url) return true; // Empty is valid (optional field)
  try {
    // Allow relative URLs starting with /
    if (url.startsWith("/")) return true;
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export default function CreateBar() {
  const navigate = useNavigate();
  const submit = useSubmit();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  // Form state
  const [formData, setFormData] = useState<FormData>({
    type: "promotional",
    content: {
      text: "",
      ctaText: "",
      ctaLink: "",
    },
    style: {
      position: "top",
      bgColor: "#1E3A5F",
      textColor: "#FFFFFF",
      fontSize: "medium",
      buttonBgColor: "#E74C3C",
      buttonTextColor: "#FFFFFF",
      progressColor: "#FFFFFF",
      progressBgColor: "rgba(255,255,255,0.3)",
    },
    settings: {
      enabled: true,
      dismissible: true,
      hideWhenExpired: false,
      showDecline: true,
      showProgressBar: true,
    },
    extra: {
      endDatetime: "",
      expiredText: "This offer has ended",
    },
    email: {
      placeholder: "Enter your email",
      buttonText: "Subscribe",
      successMessage: "Thanks! Check your inbox.",
      errorMessage: "Please enter a valid email",
    },
    cookie: {
      acceptText: "Accept",
      declineText: "Decline",
      privacyLink: "/pages/privacy-policy",
      privacyText: "Learn more",
    },
    shipping: {
      threshold: "50",
      currency: "USD",
      messageTemplate: "Spend {remaining} more for FREE shipping!",
      successMessage: "You've unlocked FREE shipping!",
    },
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const [isDirty, setIsDirty] = useState(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  // Show error toast if action failed
  useEffect(() => {
    if (actionData && !actionData.success) {
      shopify.toast.show(actionData.error || "Failed to create bar", { isError: true });
    }
  }, [actionData, shopify]);

  // Update form field helper
  const updateField = useCallback(
    <K extends Exclude<keyof FormData, "type">>(
      section: K,
      field: keyof FormData[K],
      value: FormData[K][keyof FormData[K]]
    ) => {
      setIsDirty(true);
      setFormData((prev) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: value,
        },
      }));
      // Clear error when field is updated
      if (field === "text" && errors.text) {
        setErrors((prev) => ({ ...prev, text: undefined }));
      }
      if (field === "ctaLink" && errors.ctaLink) {
        setErrors((prev) => ({ ...prev, ctaLink: undefined }));
      }
    },
    [errors]
  );



  // Update logic for deep nested keys
  const updateContent = (field: keyof FormData['content'], value: string) => updateField("content", field, value);
  const updateSettings = (field: keyof FormData['settings'], value: boolean) => updateField("settings", field, value);
  const updateExtra = (field: keyof FormData['extra'], value: string) => updateField("extra", field, value);
  const updateEmail = (field: keyof FormData['email'], value: string) => updateField("email", field, value);
  const updateCookie = (field: keyof FormData['cookie'], value: string) => updateField("cookie", field, value);
  const updateShipping = (field: keyof FormData['shipping'], value: string) => updateField("shipping", field, value);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.content.text.trim()) {
      newErrors.text = "Announcement text is required";
    }

    if (formData.type !== "countdown" && formData.content.ctaLink && !isValidUrl(formData.content.ctaLink)) {
      newErrors.ctaLink = "Please enter a valid URL";
    }

    if (formData.type === "countdown" && !formData.extra.endDatetime) {
      newErrors.endDatetime = "End date is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Handle form submit
  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      shopify.toast.show("Please fix the form errors", { isError: true });
      return;
    }

    setIsDirty(false);
    const submitData = new FormData();
    submitData.append("type", formData.type);
    submitData.append("text", formData.content.text);
    submitData.append("ctaText", formData.content.ctaText);
    submitData.append("ctaLink", formData.content.ctaLink);
    submitData.append("position", formData.style.position);
    submitData.append("bgColor", formData.style.bgColor);
    submitData.append("textColor", formData.style.textColor);
    submitData.append("fontSize", formData.style.fontSize);
    submitData.append("buttonBgColor", formData.style.buttonBgColor);
    submitData.append("buttonTextColor", formData.style.buttonTextColor);
    submitData.append("progressColor", formData.style.progressColor);
    submitData.append("progressBgColor", formData.style.progressBgColor);
    submitData.append("enabled", String(formData.settings.enabled));
    submitData.append("dismissible", String(formData.settings.dismissible));
    submitData.append("hideWhenExpired", String(formData.settings.hideWhenExpired));
    submitData.append("showDecline", String(formData.settings.showDecline));
    submitData.append("showProgressBar", String(formData.settings.showProgressBar));
    submitData.append("endDatetime", formData.extra.endDatetime);
    submitData.append("expiredText", formData.extra.expiredText);
    // Email fields
    submitData.append("emailPlaceholder", formData.email.placeholder);
    submitData.append("emailButtonText", formData.email.buttonText);
    submitData.append("emailSuccessMessage", formData.email.successMessage);
    submitData.append("emailErrorMessage", formData.email.errorMessage);
    // Cookie fields
    submitData.append("acceptText", formData.cookie.acceptText);
    submitData.append("declineText", formData.cookie.declineText);
    submitData.append("privacyLink", formData.cookie.privacyLink);
    submitData.append("privacyText", formData.cookie.privacyText);
    // Shipping fields
    submitData.append("shippingThreshold", formData.shipping.threshold);
    submitData.append("shippingCurrency", formData.shipping.currency);
    submitData.append("shippingMessageTemplate", formData.shipping.messageTemplate);
    submitData.append("shippingSuccessMessage", formData.shipping.successMessage);

    submit(submitData, { method: "post" });
  }, [formData, validateForm, submit, shopify]);



  // Check if selected type is premium
  const isPremiumType = formData.type === "email_signup";

  return (
    <Page
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      title="Create Announcement Bar"
    >
      <TitleBar title="Create Announcement Bar">
        <button onClick={() => navigate("/app")}>Cancel</button>
        <button variant="primary" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Error Banner */}
        {actionData && !actionData.success && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {/* Premium Type Warning */}
        {isPremiumType && (
          <Banner tone="warning" title="Premium Feature">
            <p>
              Email Capture bars require a Premium subscription. Upgrade your plan to use this feature.
            </p>
          </Banner>
        )}

        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Something went wrong">
              <p>{actionData.error}</p>
            </Banner>
          </Layout.Section>
        )}
        <Layout>
          {/* Left Column - Form (60%) */}
          <Layout.Section>
            <BlockStack gap="500">
              {/* Bar Type Selector */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Bar Type
                  </Text>
                  <Select
                    label="Select the type of announcement bar"
                    labelHidden
                    options={barTypeOptions}
                    value={formData.type}
                    onChange={(value) => {
                      setFormData((prev) => ({
                        ...prev,
                        type: value as BarType,
                        // Pre-fill text for countdown
                        content: {
                          ...prev.content,
                          text: value === 'countdown' && !prev.content.text ? "Sale ends in:" : prev.content.text
                        }
                      }));
                    }}
                  />
                </BlockStack>
              </Card>

              {/* Content Section */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Content
                  </Text>
                  <FormLayout>
                    {/* PROMOTIONAL / ANNOUNCEMENT */}
                    {(formData.type === "promotional" || formData.type === "announcement") && (
                      <>
                        <TextField
                          label="Announcement Text"
                          value={formData.content.text}
                          onChange={(value) => updateContent("text", value)}
                          placeholder="🎉 Free shipping on orders over $50!"
                          multiline={2}
                          maxLength={150}
                          showCharacterCount
                          autoComplete="off"
                          error={errors.text}
                          requiredIndicator
                          helpText="This is the main message visitors will see"
                        />
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Button Text"
                            value={formData.content.ctaText}
                            onChange={(value) => updateContent("ctaText", value)}
                            placeholder="Shop Now"
                            autoComplete="off"
                            helpText="Optional call-to-action button"
                          />
                          <TextField
                            label="Button Link"
                            value={formData.content.ctaLink}
                            onChange={(value) => updateContent("ctaLink", value)}
                            placeholder="/collections/sale or https://..."
                            autoComplete="off"
                            error={errors.ctaLink}
                            helpText="Where the button links to"
                          />
                        </InlineGrid>
                      </>
                    )}

                    {/* COUNTDOWN */}
                    {formData.type === "countdown" && (
                      <>
                        <TextField
                          label="Announcement Text"
                          value={formData.content.text}
                          onChange={(value) => updateContent("text", value)}
                          placeholder="Sale ends in:"
                          multiline={2}
                          maxLength={150}
                          showCharacterCount
                          autoComplete="off"
                          error={errors.text}
                          requiredIndicator
                          helpText="This is the main message visitors will see"
                        />
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="End Date & Time"
                            type="datetime-local"
                            value={formData.extra.endDatetime}
                            onChange={(value) => updateExtra("endDatetime", value)}
                            autoComplete="off"
                            error={errors.endDatetime}
                            requiredIndicator
                          />
                          <TextField
                            label="Expired Message"
                            value={formData.extra.expiredText}
                            onChange={(value) => updateExtra("expiredText", value)}
                            placeholder="This offer has ended"
                            autoComplete="off"
                            helpText="Shown when countdown reaches zero"
                          />
                        </InlineGrid>
                      </>
                    )}

                    {/* EMAIL CAPTURE */}
                    {formData.type === "email_signup" && (
                      <>
                        <TextField
                          label="Headline Text"
                          value={formData.content.text}
                          onChange={(value) => updateContent("text", value)}
                          placeholder="Get 10% off your first order!"
                          maxLength={100}
                          showCharacterCount
                          autoComplete="off"
                          error={errors.text}
                          requiredIndicator
                          helpText="Main headline to encourage signups"
                        />
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Input Placeholder"
                            value={formData.email.placeholder}
                            onChange={(value) => updateEmail("placeholder", value)}
                            placeholder="Enter your email"
                            autoComplete="off"
                          />
                          <TextField
                            label="Button Text"
                            value={formData.email.buttonText}
                            onChange={(value) => updateEmail("buttonText", value)}
                            placeholder="Subscribe"
                            autoComplete="off"
                          />
                        </InlineGrid>
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Success Message"
                            value={formData.email.successMessage}
                            onChange={(value) => updateEmail("successMessage", value)}
                            placeholder="Thanks! Check your inbox."
                            autoComplete="off"
                            helpText="Shown after successful submission"
                          />
                          <TextField
                            label="Error Message"
                            value={formData.email.errorMessage}
                            onChange={(value) => updateEmail("errorMessage", value)}
                            placeholder="Please enter a valid email"
                            autoComplete="off"
                            helpText="Shown for invalid email"
                          />
                        </InlineGrid>
                      </>
                    )}

                    {/* COOKIE CONSENT */}
                    {formData.type === "cookie_consent" && (
                      <>
                        <TextField
                          label="Consent Message"
                          value={formData.content.text}
                          onChange={(value) => updateContent("text", value)}
                          placeholder="We use cookies to improve your experience."
                          multiline={2}
                          maxLength={200}
                          showCharacterCount
                          autoComplete="off"
                          helpText="Main consent message"
                        />
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Accept Button Text"
                            value={formData.cookie.acceptText}
                            onChange={(value) => updateCookie("acceptText", value)}
                            placeholder="Accept"
                            autoComplete="off"
                          />
                          <TextField
                            label="Decline Button Text"
                            value={formData.cookie.declineText}
                            onChange={(value) => updateCookie("declineText", value)}
                            placeholder="Decline"
                            autoComplete="off"
                          />
                        </InlineGrid>
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Privacy Policy URL"
                            value={formData.cookie.privacyLink}
                            onChange={(value) => updateCookie("privacyLink", value)}
                            placeholder="/pages/privacy-policy"
                            autoComplete="off"
                            requiredIndicator
                            helpText="Link to your privacy policy"
                          />
                          <TextField
                            label="Privacy Link Text"
                            value={formData.cookie.privacyText}
                            onChange={(value) => updateCookie("privacyText", value)}
                            placeholder="Learn more"
                            autoComplete="off"
                          />
                        </InlineGrid>
                      </>
                    )}

                    {/* FREE SHIPPING */}
                    {formData.type === "free_shipping" && (
                      <>
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Shipping Threshold"
                            type="number"
                            value={formData.shipping.threshold}
                            onChange={(value) => updateShipping("threshold", value)}
                            placeholder="50"
                            autoComplete="off"
                            requiredIndicator
                            helpText="Order amount for free shipping"
                          />
                          <Select
                            label="Currency"
                            options={[
                              { label: "USD ($)", value: "USD" },
                              { label: "EUR (€)", value: "EUR" },
                              { label: "GBP (£)", value: "GBP" },
                              { label: "INR (₹)", value: "INR" },
                              { label: "CAD ($)", value: "CAD" },
                              { label: "AUD ($)", value: "AUD" },
                            ]}
                            value={formData.shipping.currency}
                            onChange={(value) => updateShipping("currency", value)}
                          />
                        </InlineGrid>
                        <TextField
                          label="Progress Message"
                          value={formData.shipping.messageTemplate}
                          onChange={(value) => updateShipping("messageTemplate", value)}
                          placeholder="Spend {remaining} more for FREE shipping!"
                          autoComplete="off"
                          helpText="Use {remaining} for the remaining amount"
                        />
                        <TextField
                          label="Success Message"
                          value={formData.shipping.successMessage}
                          onChange={(value) => updateShipping("successMessage", value)}
                          placeholder="You've unlocked FREE shipping!"
                          autoComplete="off"
                          helpText="Shown when threshold is reached"
                        />
                      </>
                    )}
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Style Section */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Style
                  </Text>
                  <FormLayout>
                    {/* Position */}
                    <BlockStack gap="200">
                      <Text as="span" variant="bodyMd">
                        Position
                      </Text>
                      <ButtonGroup variant="segmented">
                        <Button
                          pressed={formData.style.position === "top"}
                          onClick={() => updateField("style", "position", "top")}
                        >
                          Top
                        </Button>
                        <Button
                          pressed={formData.style.position === "bottom"}
                          onClick={() => updateField("style", "position", "bottom")}
                        >
                          Bottom
                        </Button>
                      </ButtonGroup>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formData.type === "cookie_consent" ? "Recommended: Bottom for cookie consent" : "Where the bar appears on your store"}
                      </Text>
                    </BlockStack>

                    {/* Colors */}
                    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                      <ColorPicker
                        label="Background Color"
                        value={formData.style.bgColor}
                        onChange={(color) => updateField("style", "bgColor", color)}
                        helpText="Choose a contrasting color for visibility"
                      />
                      <ColorPicker
                        label="Text Color"
                        value={formData.style.textColor}
                        onChange={(color) => updateField("style", "textColor", color)}
                        helpText="Should contrast with background"
                      />
                    </InlineGrid>

                    {/* Button Colors - for email capture and cookie consent */}
                    {(formData.type === "email_signup" || formData.type === "cookie_consent") && (
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                        <ColorPicker
                          label="Button Background"
                          value={formData.style.buttonBgColor}
                          onChange={(color) => updateField("style", "buttonBgColor", color)}
                          helpText="Primary button background color"
                        />
                        <ColorPicker
                          label="Button Text Color"
                          value={formData.style.buttonTextColor}
                          onChange={(color) => updateField("style", "buttonTextColor", color)}
                          helpText="Primary button text color"
                        />
                      </InlineGrid>
                    )}

                    {/* Progress Bar Colors - for free shipping */}
                    {formData.type === "free_shipping" && (
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                        <ColorPicker
                          label="Progress Bar Color"
                          value={formData.style.progressColor}
                          onChange={(color) => updateField("style", "progressColor", color)}
                          helpText="Filled progress bar color"
                        />
                        <ColorPicker
                          label="Progress Bar Background"
                          value={formData.style.progressBgColor}
                          onChange={(color) => updateField("style", "progressBgColor", color)}
                          helpText="Empty progress bar background"
                        />
                      </InlineGrid>
                    )}

                    {/* Font Size */}
                    <FontSizeSelector
                      value={formData.style.fontSize}
                      onChange={(size) => updateField("style", "fontSize", size)}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Settings Section */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Settings
                  </Text>
                  <BlockStack gap="300">
                    <Checkbox
                      label="Enable this bar"
                      helpText="Bar will be visible on your store when enabled"
                      checked={formData.settings.enabled}
                      onChange={(checked) => updateField("settings", "enabled", checked)}
                    />
                    {formData.type !== "cookie_consent" && (
                      <Checkbox
                        label="Allow visitors to dismiss"
                        helpText="Shows an X button so visitors can close the bar"
                        checked={formData.settings.dismissible}
                        onChange={(checked) => updateSettings("dismissible", checked)}
                      />
                    )}
                    {formData.type === "countdown" && (
                      <Checkbox
                        label="Hide bar when expired"
                        helpText="If checked, the bar will disappear instead of showing the expired message"
                        checked={formData.settings.hideWhenExpired}
                        onChange={(checked) => updateSettings("hideWhenExpired", checked)}
                      />
                    )}
                    {formData.type === "cookie_consent" && (
                      <Checkbox
                        label="Show decline button"
                        helpText="If unchecked, only the Accept button will be shown"
                        checked={formData.settings.showDecline}
                        onChange={(checked) => updateSettings("showDecline", checked)}
                      />
                    )}
                    {formData.type === "free_shipping" && (
                      <Checkbox
                        label="Show progress bar"
                        helpText="Visual progress bar showing how close to free shipping"
                        checked={formData.settings.showProgressBar}
                        onChange={(checked) => updateSettings("showProgressBar", checked)}
                      />
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* Right Column - Preview (40%) */}
          <Layout.Section variant="oneThird">
            <Box position="sticky" insetBlockStart="400">
              <BarPreview
                type={formData.type}
                content={{
                  text: formData.content.text,
                  ctaText: formData.content.ctaText,
                  ctaLink: formData.content.ctaLink,
                  endDatetime: formData.extra.endDatetime,
                  expiredText: formData.extra.expiredText,
                  // Email fields
                  placeholder: formData.email.placeholder,
                  buttonText: formData.email.buttonText,
                  successMessage: formData.email.successMessage,
                  // Cookie fields
                  acceptText: formData.cookie.acceptText,
                  declineText: formData.cookie.declineText,
                  privacyLink: formData.cookie.privacyLink,
                  privacyText: formData.cookie.privacyText,
                  // Shipping fields
                  threshold: parseFloat(formData.shipping.threshold) || 50,
                  currency: formData.shipping.currency,
                  messageTemplate: formData.shipping.messageTemplate,
                  shippingSuccessMessage: formData.shipping.successMessage,
                }}
                style={{
                  position: formData.style.position,
                  bgColor: formData.style.bgColor,
                  textColor: formData.style.textColor,
                  fontSize: formData.style.fontSize,
                  buttonBgColor: formData.style.buttonBgColor,
                  buttonTextColor: formData.style.buttonTextColor,
                  progressColor: formData.style.progressColor,
                  progressBgColor: formData.style.progressBgColor,
                }}
                settings={{
                  dismissible: formData.settings.dismissible,
                  hideWhenExpired: formData.settings.hideWhenExpired,
                  showDecline: formData.settings.showDecline,
                  showProgressBar: formData.settings.showProgressBar,
                }}
              />

              {/* Tips Card */}
              <Box paddingBlockStart="400">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      Tips
                    </Text>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        • Keep messages short and actionable
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        • Use contrasting colors for visibility
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        • Add a CTA button to drive clicks
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Box>
            </Box>
          </Layout.Section>
        </Layout>

        {/* Form Footer */}
        <Divider />
        <InlineStack align="end" gap="300">
          <Button onClick={() => navigate("/app")}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={isSaving}>
            Create Bar
          </Button>
        </InlineStack>
      </BlockStack>
      {blocker.state === "blocked" && (
        <Modal
          open
          title="Unsaved changes"
          primaryAction={{
            content: "Discard changes",
            onAction: () => blocker.proceed(),
            destructive: true,
          }}
          secondaryActions={[{
            content: "Keep editing",
            onAction: () => blocker.reset(),
          }]}
          onClose={() => blocker.reset()}
        >
          <Modal.Section>
            <p>You have unsaved changes. Leaving this page will discard them.</p>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
