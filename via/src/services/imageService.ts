const STATIC_IMAGES = {
  day: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop",
  night: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070&auto=format&fit=crop"
};

export async function generateBackgroundImage() {
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 18;
  return isNight ? STATIC_IMAGES.night : STATIC_IMAGES.day;
}
