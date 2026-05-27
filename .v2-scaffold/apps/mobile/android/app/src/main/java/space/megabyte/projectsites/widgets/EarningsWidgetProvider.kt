package space.megabyte.projectsites.widgets

/**
 * `EarningsWidgetProvider` — Android home-screen widget.
 *
 * Data source: a `SharedPreferences` file named `ps_widget_prefs` that
 * the Capacitor app writes to via the `@capacitor/preferences` plugin
 * (group key `ps:widget`). The Capacitor side mirrors the iOS App Group
 * write-on-event flow so both shells share one update pipeline.
 *
 * Updated keys:
 *   - `role`               -> "crew" | "customer"
 *   - `earningsTodayCents` -> Int (crew)
 *   - `nextBookingTitle`   -> String (customer)
 *   - `nextBookingTime`    -> String (customer)
 *
 * The widget is registered in `AndroidManifest.xml` via the
 * `<receiver>` block and the metadata in
 * `res/xml/earnings_widget_info.xml`.
 */

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import space.megabyte.projectsites.R
import java.text.NumberFormat
import java.util.Currency

class EarningsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val PREFS_NAME = "ps_widget_prefs"
        const val KEY_ROLE = "role"
        const val KEY_EARNINGS_CENTS = "earningsTodayCents"
        const val KEY_NEXT_BOOKING_TITLE = "nextBookingTitle"
        const val KEY_NEXT_BOOKING_TIME = "nextBookingTime"
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) {
            updateWidget(context, appWidgetManager, id)
        }
    }

    private fun updateWidget(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val role = prefs.getString(KEY_ROLE, "customer") ?: "customer"

        val views = RemoteViews(context.packageName, R.layout.widget_earnings)

        if (role == "crew") {
            val cents = prefs.getInt(KEY_EARNINGS_CENTS, 0)
            views.setTextViewText(R.id.widget_title, "Today")
            views.setTextViewText(R.id.widget_value, formatUsd(cents))
            views.setTextViewText(R.id.widget_subtitle, "Earnings")
        } else {
            val title = prefs.getString(KEY_NEXT_BOOKING_TITLE, "No upcoming bookings")
                ?: "No upcoming bookings"
            val time = prefs.getString(KEY_NEXT_BOOKING_TIME, "") ?: ""
            views.setTextViewText(R.id.widget_title, "Next booking")
            views.setTextViewText(R.id.widget_value, title)
            views.setTextViewText(R.id.widget_subtitle, time)
        }

        // Tap → open the app's deep-linked dashboard.
        val launchIntent = Intent(context, Class.forName("space.megabyte.projectsites.MainActivity"))
        launchIntent.action = Intent.ACTION_VIEW
        val pending = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        views.setOnClickPendingIntent(R.id.widget_root, pending)

        manager.updateAppWidget(widgetId, views)
    }

    private fun formatUsd(cents: Int): String {
        val dollars = cents.toDouble() / 100.0
        val nf = NumberFormat.getCurrencyInstance().apply {
            currency = Currency.getInstance("USD")
            maximumFractionDigits = 2
        }
        return nf.format(dollars)
    }
}
