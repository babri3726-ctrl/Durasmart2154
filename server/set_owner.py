"""
Utility to promote or create any user as an Owner in DuraSmart.
Usage:
    python server/set_owner.py <email_or_username> [password] [full_name]
Example:
    python server/set_owner.py babri3726@gmail.com MySecurePass@123 "Dharampal Jindal"
"""
import sys
import os

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import db

def main():
    if len(sys.argv) < 2:
        print("Usage: python server/set_owner.py <email_or_username> [password] [full_name]")
        sys.exit(1)

    identifier = sys.argv[1].strip()
    password = sys.argv[2].strip() if len(sys.argv) > 2 else None
    name = sys.argv[3].strip() if len(sys.argv) > 3 else None

    result = db.set_user_as_owner(identifier, password=password, name=name)
    print(f"Successfully configured Owner account:")
    print(f"  Status: {result['status']}")
    print(f"  Action: {result['action']}")
    print(f"  User ID: {result['id']}")
    print(f"  Email: {result['email']}")
    print(f"  Role: {result['role']}")
    if password:
        print(f"  Password has been updated.")

if __name__ == "__main__":
    main()
