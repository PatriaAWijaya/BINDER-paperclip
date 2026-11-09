import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { announcementPreview, announcementAnimationPreview } from "@/lib/announcement-preview";

const meta = {
  parameters: { paperclip: {
      "capabilities": [
        "navigation-preferences/announcements"
      ],
      "implementation": "production",
      "boundary": "fixtures"
    } },
  id: "announcements-announcementcard",
  title: "Oversight and operation/Navigation, profile, and announcements/Announcements/AnnouncementCard",
  component: AnnouncementCard,
  args: { announcement: announcementPreview, imageSrc: "/announcement-preview.svg", onDismiss: () => {} },
  decorators: [(Story) => <div className="p-4"><Story /></div>],
} satisfies Meta<typeof AnnouncementCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Light: Story = { globals: { theme: "light" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const Mobile: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
export const MissingImage: Story = { args: { imageSrc: "/missing-announcement-image.png" } };
export const TextOnly: Story = { args: { announcement: { ...announcementPreview, image: undefined, secondaryLink: undefined } } };
export const LongText: Story = {
  args: { announcement: { ...announcementPreview, title: "Give your most ambitious ideas a team that can carry them forward", description: "Organize your agents around a shared goal, bring the work into one place, and keep every decision connected to its context. Follow progress, review outcomes, and help your team take the next step whenever it needs your direction.", primaryAction: { kind: "external", label: "See everything that’s new in Paperclip", url: "https://paperclip.ing" } } },
};

// NOTE: the Animated stories were removed with the animated hero asset:
// the repo-root `announcements/` demo directory was deleted by the BINDER
// cleanup, so there is no animation source to embed anymore. The
// MissingAnimation story below still covers the missing-asset fallback.
export const MissingAnimation: Story = { args: { announcement: announcementAnimationPreview, animationSrc: "/missing-announcement-animation.html" } };
