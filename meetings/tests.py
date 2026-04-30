from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Meeting


@override_settings(
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
)
class MeetingViewsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="teacher", password="pass12345")
        self.client.login(username="teacher", password="pass12345")

    def test_dashboard_create_redirects_to_lobby(self):
        response = self.client.post(reverse("dashboard"), {"action": "create"}, secure=True)

        meeting = Meeting.objects.get(host=self.user)
        self.assertRedirects(
            response,
            reverse("lobby", args=[meeting.room_id]),
            fetch_redirect_response=False,
        )

    def test_lobby_context_contains_absolute_invite_link(self):
        meeting = Meeting.objects.create(host=self.user)

        response = self.client.get(reverse("lobby", args=[meeting.room_id]), secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.context["invite_link"],
            f"https://testserver/meetings/lobby/{meeting.room_id}/",
        )
