import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Hosts the shell's branch navigators in a horizontal [PageView] so tabs can be
/// swiped Instagram-style, kept in sync with the bottom nav (tap ↔ swipe).
class BranchPager extends StatefulWidget {
  const BranchPager({
    super.key,
    required this.navigationShell,
    required this.children,
  });

  final StatefulNavigationShell navigationShell;
  final List<Widget> children;

  @override
  State<BranchPager> createState() => _BranchPagerState();
}

class _BranchPagerState extends State<BranchPager> {
  late final PageController _controller =
      PageController(initialPage: widget.navigationShell.currentIndex);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Bottom-nav tap changed the branch → animate the pager to match.
    final index = widget.navigationShell.currentIndex;
    if (_controller.hasClients &&
        (_controller.page?.round() ?? index) != index) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_controller.hasClients) {
          _controller.animateToPage(
            index,
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
          );
        }
      });
    }

    return PageView(
      controller: _controller,
      physics: const ClampingScrollPhysics(),
      onPageChanged: (i) {
        if (i != widget.navigationShell.currentIndex) {
          widget.navigationShell.goBranch(i);
        }
      },
      children: widget.children,
    );
  }
}
