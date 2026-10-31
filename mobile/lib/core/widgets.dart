import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../data/models.dart';
import 'share_service.dart';
import 'theme.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: compact ? 42 : 48,
          height: compact ? 42 : 48,
          decoration: BoxDecoration(
            gradient: AppGradients.brand,
            borderRadius: BorderRadius.circular(15),
          ),
          child: const Icon(
            Icons.apartment_rounded,
            color: Colors.white,
            size: 25,
          ),
        ),
        if (!compact) ...[
          const SizedBox(width: 11),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'DEMO OPERATIONS',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.navy,
                  letterSpacing: .4,
                  fontSize: 16,
                ),
              ),
              Text(
                'OPERATIONS PLATFORM',
                style: TextStyle(
                  fontSize: 9,
                  color: AppColors.muted,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class GradientHero extends StatelessWidget {
  const GradientHero({
    super.key,
    required this.child,
    this.height = 160,
    this.gradient,
  });
  final Widget child;
  final double height;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    height: height,
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      gradient: gradient ?? AppGradients.brand,
      borderRadius: BorderRadius.circular(25),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1D6A52DC),
          blurRadius: 22,
          offset: Offset(0, 9),
        ),
      ],
    ),
    child: child,
  );
}

class WhitePanel extends StatelessWidget {
  const WhitePanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(15),
    this.onTap,
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(AppRadius.card),
      boxShadow: const [
        BoxShadow(
          color: Color(0x070A1B44),
          blurRadius: 16,
          offset: Offset(0, 5),
        ),
      ],
    ),
    // The transparent Material keeps ink and ListTile backgrounds above this
    // DecoratedBox, so taps stay visible on the white card surface.
    child: Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppRadius.card),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: padding,
        child: onTap == null ? child : InkWell(onTap: onTap, child: child),
      ),
    ),
  );
}

class SectionHeading extends StatelessWidget {
  const SectionHeading({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
  });
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: AppText.title),
            if (subtitle != null) ...[
              const SizedBox(height: 3),
              Text(subtitle!, style: AppText.caption),
            ],
          ],
        ),
      ),
      ?trailing,
    ],
  );
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .12),
      borderRadius: BorderRadius.circular(50),
    ),
    child: Text(
      label,
      style: TextStyle(
        color: color,
        fontWeight: FontWeight.w800,
        fontSize: 9.5,
      ),
    ),
  );
}

class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.title,
    required this.value,
    this.caption,
    required this.icon,
    this.gradient,
  });
  final String title;
  final String value;
  final String? caption;
  final IconData icon;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(21),
      boxShadow: const [
        BoxShadow(
          color: Color(0x080A1B44),
          blurRadius: 18,
          offset: Offset(0, 7),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                gradient: gradient ?? AppGradients.brand,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, color: Colors.white, size: 18),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.value,
        ),
        if (caption != null) ...[
          const SizedBox(height: 3),
          Text(
            caption!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 10, color: AppColors.muted),
          ),
        ],
      ],
    ),
  );
}

class ActionPill extends StatelessWidget {
  const ActionPill({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    onPressed: onTap,
    icon: Icon(icon, size: 17),
    label: Text(label),
    style: OutlinedButton.styleFrom(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.navy,
      side: const BorderSide(color: Color(0xFFE5E8F3)),
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 13),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
    ),
  );
}

class InfoRow extends StatelessWidget {
  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
  });
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        ),
        const SizedBox(width: 14),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: TextStyle(
              color: valueColor ?? AppColors.ink,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ),
      ],
    ),
  );
}

class DemoNotice extends StatelessWidget {
  const DemoNotice({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFFEFF3FF),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: const Color(0xFFDCE5FF)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.info_outline_rounded, color: AppColors.blue, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: Color(0xFF42537A),
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ),
      ],
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.action,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(28),
    child: Column(
      children: [
        Icon(icon, size: 42, color: AppColors.muted),
        const SizedBox(height: 8),
        Text(title, style: AppText.heading),
        const SizedBox(height: 4),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        if (action != null) ...[const SizedBox(height: 14), action!],
      ],
    ),
  );
}

class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.hint,
    required this.onChanged,
    this.controller,
  });
  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    onChanged: onChanged,
    textInputAction: TextInputAction.search,
    decoration: InputDecoration(
      prefixIcon: const Icon(Icons.search_rounded),
      hintText: hint,
    ),
  );
}

class FilterChipsRow extends StatelessWidget {
  const FilterChipsRow({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });
  final List<String> options;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final option in options)
          Padding(
            padding: const EdgeInsets.only(right: 8, bottom: 4),
            child: ChoiceChip(
              label: Text(option),
              selected: selected == option,
              onSelected: (_) => onSelected(option),
              selectedColor: AppColors.purple.withValues(alpha: .15),
              labelStyle: TextStyle(
                fontSize: 12,
                fontWeight: selected == option
                    ? FontWeight.w800
                    : FontWeight.w600,
                color: selected == option ? AppColors.purple : AppColors.muted,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
      ],
    ),
  );
}

class WhatsAppButton extends StatelessWidget {
  const WhatsAppButton({
    super.key,
    required this.label,
    required this.phone,
    required this.message,
    this.photos,
    this.outlined = false,
    this.expand = true,
  });
  final String label;
  final String phone;
  final String message;
  final List<DemoPhoto>? photos;
  final bool outlined;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final button = photos != null && photos!.isNotEmpty
        ? (outlined
              ? OutlinedButton.icon(
                  onPressed: () =>
                      sharePhotos(context, message: message, photos: photos!),
                  icon: const Icon(Icons.chat_rounded, size: 18),
                  label: Text(label),
                )
              : FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.whatsapp,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () =>
                      sharePhotos(context, message: message, photos: photos!),
                  icon: const Icon(Icons.chat_rounded, size: 18),
                  label: Text(label),
                ))
        : (outlined
              ? OutlinedButton.icon(
                  onPressed: () => shareWhatsAppText(
                    context,
                    phone: phone,
                    message: message,
                  ),
                  icon: const Icon(Icons.chat_rounded, size: 18),
                  label: Text(label),
                )
              : FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.whatsapp,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => shareWhatsAppText(
                    context,
                    phone: phone,
                    message: message,
                  ),
                  icon: const Icon(Icons.chat_rounded, size: 18),
                  label: Text(label),
                ));
    if (!expand) return button;
    return SizedBox(width: double.infinity, child: button);
  }
}

class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.gradient,
    this.loading = false,
    this.height = 50,
    this.expand = true,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Gradient? gradient;
  final bool loading;
  final double height;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    return Opacity(
      opacity: enabled ? 1 : .55,
      child: Container(
        width: expand ? double.infinity : null,
        height: height,
        decoration: BoxDecoration(
          gradient: gradient ?? AppGradients.brand,
          borderRadius: BorderRadius.circular(15),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(15),
            onTap: enabled ? onPressed : null,
            child: Center(
              child: loading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2.5,
                      ),
                    )
                  : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (icon != null) ...[
                          Icon(icon, color: Colors.white, size: 20),
                          const SizedBox(width: 8),
                        ],
                        Text(
                          label,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            fontSize: 14.5,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class AvatarCircle extends StatelessWidget {
  const AvatarCircle({
    super.key,
    required this.name,
    this.size = 44,
    this.gradient,
  });
  final String name;
  final double size;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+'));
    final initials = parts
        .map((p) => p.isNotEmpty ? p[0].toUpperCase() : '')
        .take(2)
        .join();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: gradient ?? AppGradients.brand,
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          initials,
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
            fontSize: size * .34,
          ),
        ),
      ),
    );
  }
}

class ConfirmDialog {
  static Future<bool> show(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Confirm',
    bool danger = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(title, style: AppText.title),
        content: Text(
          message,
          style: const TextStyle(fontSize: 13, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: danger ? AppColors.red : AppColors.purple,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }
}

/// Camera / gallery photo picker strip used by Orders, Dispatch, Tasks and
/// Tour visits. Stores picked images as [DemoPhoto] bytes for previews.
class PhotoPickerPanel extends StatefulWidget {
  const PhotoPickerPanel({
    super.key,
    required this.title,
    this.helper = 'Add photos from camera or gallery.',
    required this.photos,
    required this.onPhotosChanged,
    this.maxPhotos = 6,
  });
  final String title;
  final String helper;
  final List<DemoPhoto> photos;
  final ValueChanged<List<DemoPhoto>> onPhotosChanged;
  final int maxPhotos;

  @override
  State<PhotoPickerPanel> createState() => _PhotoPickerPanelState();
}

class _PhotoPickerPanelState extends State<PhotoPickerPanel> {
  final _picker = ImagePicker();

  Future<void> _pick(ImageSource source) async {
    if (widget.photos.length >= widget.maxPhotos) {
      showDemoSnack(
        context,
        'Maximum ${widget.maxPhotos} photos for this demo.',
      );
      return;
    }
    try {
      final picked = await _picker.pickImage(
        source: source,
        imageQuality: 82,
        maxWidth: 1800,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      widget.onPhotosChanged([
        ...widget.photos,
        DemoPhoto(picked.path.hashCode.toString(), picked.name, bytes),
      ]);
    } catch (_) {
      if (mounted) {
        showDemoSnack(
          context,
          'Photo picker is not available in this environment.',
        );
      }
    }
  }

  void _remove(int index) {
    final next = List<DemoPhoto>.from(widget.photos)..removeAt(index);
    widget.onPhotosChanged(next);
  }

  @override
  Widget build(BuildContext context) => WhitePanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.add_a_photo_rounded, color: AppColors.purple),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        Text(
          widget.helper,
          style: const TextStyle(
            fontSize: 11,
            color: AppColors.muted,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 13),
        Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            OutlinedButton.icon(
              onPressed: () => _pick(ImageSource.camera),
              icon: const Icon(Icons.camera_alt_outlined),
              label: const Text('Camera'),
            ),
            OutlinedButton.icon(
              onPressed: () => _pick(ImageSource.gallery),
              icon: const Icon(Icons.photo_library_outlined),
              label: const Text('Gallery'),
            ),
          ],
        ),
        if (widget.photos.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            '${widget.photos.length} photo(s) selected',
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: AppColors.green,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 8),
          PhotoStrip(photos: widget.photos, onRemove: _remove),
        ],
      ],
    ),
  );
}

class PhotoStrip extends StatelessWidget {
  const PhotoStrip({
    super.key,
    required this.photos,
    this.onRemove,
    this.size = 100,
  });
  final List<DemoPhoto> photos;
  final ValueChanged<int>? onRemove;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: size,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: photos.length,
      separatorBuilder: (_, _) => const SizedBox(width: 9),
      itemBuilder: (context, i) => PhotoThumbnail(
        photo: photos[i],
        size: size,
        onRemove: onRemove == null ? null : () => onRemove!(i),
      ),
    ),
  );
}

class PhotoThumbnail extends StatelessWidget {
  const PhotoThumbnail({
    super.key,
    required this.photo,
    this.size = 100,
    this.onRemove,
  });
  final DemoPhoto photo;
  final double size;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      InkWell(
        onTap: () => showDialog<void>(
          context: context,
          builder: (dialogContext) => Dialog.fullscreen(
            backgroundColor: Colors.black,
            child: Stack(
              children: [
                InteractiveViewer(
                  child: Center(child: Image.memory(photo.bytes)),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: IconButton(
                    icon: const Icon(Icons.close_rounded, color: Colors.white),
                    onPressed: () => Navigator.pop(dialogContext),
                  ),
                ),
              ],
            ),
          ),
        ),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: const Color(0xFFF1F2FA),
            borderRadius: BorderRadius.circular(13),
          ),
          clipBehavior: Clip.antiAlias,
          child: Image.memory(photo.bytes, fit: BoxFit.cover),
        ),
      ),
      if (onRemove != null)
        Positioned(
          right: 4,
          top: 4,
          child: InkWell(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: const BoxDecoration(
                color: Colors.black54,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.close_rounded,
                color: Colors.white,
                size: 15,
              ),
            ),
          ),
        ),
    ],
  );
}

class ProgressRow extends StatelessWidget {
  const ProgressRow({
    super.key,
    required this.label,
    required this.value,
    required this.max,
    this.color,
  });
  final String label;
  final double value;
  final double max;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ratio = max <= 0 ? 0.0 : (value / max).clamp(0.0, 1.0).toDouble();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: AppText.body)),
            Text(
              '${(ratio * 100).round()}%',
              style: TextStyle(
                color: color ?? AppColors.purple,
                fontWeight: FontWeight.w900,
                fontSize: 12,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: LinearProgressIndicator(
            value: ratio,
            minHeight: 7,
            backgroundColor: const Color(0xFFEBEDF5),
            color: color ?? AppColors.purple,
          ),
        ),
      ],
    );
  }
}
