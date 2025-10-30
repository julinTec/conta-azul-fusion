import { supabase } from "@/integrations/supabase/client";

export const getValidAccessToken = async (): Promise<string | null> => {
  const token = localStorage.getItem("conta_azul_access_token");
  const refreshToken = localStorage.getItem("conta_azul_refresh_token");
  const expiresAt = localStorage.getItem("conta_azul_token_expires_at");

  if (!token || !refreshToken) {
    return null;
  }

  // Check if token is still valid (with 5 minute buffer)
  const now = Date.now();
  const expirationTime = expiresAt ? parseInt(expiresAt) : 0;
  const bufferTime = 5 * 60 * 1000; // 5 minutes

  if (expirationTime > now + bufferTime) {
    return token;
  }

  // Token expired or about to expire, refresh it
  console.log("Access token expired, refreshing...");

  try {
    const { data, error } = await supabase.functions.invoke("conta-azul-auth", {
      body: { refreshToken },
    });

    if (error) {
      console.error("Error refreshing token:", error);
      // Clear invalid tokens
      localStorage.removeItem("conta_azul_access_token");
      localStorage.removeItem("conta_azul_refresh_token");
      localStorage.removeItem("conta_azul_token_expires_at");
      return null;
    }

    // Update tokens in localStorage
    localStorage.setItem("conta_azul_access_token", data.access_token);
    localStorage.setItem("conta_azul_refresh_token", data.refresh_token);
    localStorage.setItem(
      "conta_azul_token_expires_at",
      String(Date.now() + data.expires_in * 1000)
    );

    console.log("Token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    // Clear invalid tokens
    localStorage.removeItem("conta_azul_access_token");
    localStorage.removeItem("conta_azul_refresh_token");
    localStorage.removeItem("conta_azul_token_expires_at");
    return null;
  }
};
